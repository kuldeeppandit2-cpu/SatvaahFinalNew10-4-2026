// services/search/src/services/suggestService.ts
//
// Taxonomy autocomplete for the search bar.
//
// RULES (from MASTER_CONTEXT):
//   • Taxonomy-constrained ONLY — never searches raw provider records.
//   • Minimum 2 chars (suggest_min_chars from system_config, default 2).
//   • Maximum 8 results (suggest_max_results from system_config, default 8).
//   • Fuzzy match on taxonomy_nodes.l4 using PostgreSQL ILIKE / pg_trgm.
//   • Returns: { id, l4, breadcrumb: 'l1 → l2 → l3' }
//
// Why Postgres and not OpenSearch for suggest?
//   taxonomy_nodes is a small, rarely-changing reference table (~5k rows).
//   A Prisma ILIKE query with an indexed column is fast (< 5 ms) and does not
//   require a separate OpenSearch taxonomy index. The response is NOT cached
//   per query because debouncing (300 ms) in the client already limits traffic.

import { prisma } from '@satvaaah/db';
import { loadSystemConfig } from '@satvaaah/config';
import { logger } from '@satvaaah/logger';
import { AppError } from '@satvaaah/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SuggestInput {
  q: string;
  tab?: string;
  correlationId: string;
}

export interface SuggestResult {
  id: string;
  l4: string;
  breadcrumb: string; // 'l1 → l2 → l3'
}

// ─── suggestService ───────────────────────────────────────────────────────────

export async function suggestService(
  input: SuggestInput,
): Promise<SuggestResult[]> {
  const { q, tab, correlationId } = input;

  // ── Load config constraints ───────────────────────────────────────────────
  const config = await loadSystemConfig();
  const minChars = parseInt(config['suggest_min_chars'] ?? '2', 10);
  const maxResults = parseInt(config['suggest_max_results'] ?? '8', 10);

  if (q.length < minChars) {
    throw new AppError(
      'SUGGEST_QUERY_TOO_SHORT',
      `Query must be at least ${minChars} characters`,
      400,
    );
  }

  logger.info('suggest.query.start', {
    correlationId,
    q,
    tab: tab ?? null,
    minChars,
    maxResults,
  });

  // ── Build Prisma WHERE clause ─────────────────────────────────────────────
  // We do a case-insensitive ILIKE on l4 only. The leading + trailing %
  // allows mid-word matches ("plumb" matches "plumber", "plumbing").
  //
  // If tab is provided, filter to nodes that belong to that tab segment.
  // taxonomy_nodes.tab must exist as a column for this to work.
  const whereClause: Record<string, unknown> = {
    l4: {
      contains: q.trim(),
      mode: 'insensitive',
    },
    is_active: true,
  };

  if (
    tab &&
    ['products', 'services', 'expertise', 'establishments'].includes(tab)
  ) {
    whereClause['tab'] = tab;
  }

  // ── Query taxonomy_nodes ──────────────────────────────────────────────────
  const nodes = await prisma.taxonomyNode.findMany({
    where: whereClause as any,
    select: {
      id: true,
      l1: true,
      l2: true,
      l3: true,
      l4: true,
    },
    take: maxResults,
    orderBy: [
      // Exact prefix matches first (l4 starts with query term)
      // Prisma doesn't support ORDER BY CASE, so we rely on DB index scan order.
      // The index on (tab, l4) ensures prefix hits surface early.
      { l4: 'asc' },
    ],
  });

  const results: SuggestResult[] = nodes
    .filter((node) => node.l4 != null) // l4 is nullable in schema
    .map((node) => ({
    id: node.id,
    l4: node.l4!,
    breadcrumb: [node.l1, node.l2, node.l3]
      .filter(Boolean)
      .join(' \u2192 '), // → character
  }));

  logger.info('suggest.query.success', {
    correlationId,
    q,
    returned: results.length,
  });

  return results;
}
