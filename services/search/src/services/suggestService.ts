// services/search/src/services/suggestService.ts
//
// Taxonomy autocomplete for the search bar.
//
// RULES:
//   • Taxonomy-constrained ONLY — never searches raw provider records.
//   • Minimum 2 chars (suggest_min_chars from system_config, default 2).
//   • Maximum 8 results (suggest_max_results from system_config, default 8).
//   • Match on l4 (display name) AND search_synonyms (multilingual terms).
//   • Returns full TaxonomyNode shape that mobile SearchScreen expects.
//
// Why Postgres and not OpenSearch?
//   taxonomy_nodes is ~1555 rows. $queryRaw ILIKE is < 5 ms. No separate index needed.

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

/** Full shape returned to mobile — matches TaxonomyNode interface in search.api.ts */
export interface SuggestResult {
  id: string;
  name: string;                      // = l4 — label shown in dropdown
  l1: string;
  l2: string | null;
  l3: string | null;
  l4: string | null;
  tab: string;
  homeVisit: boolean;
  search_intent_expiry_days: number | null;
  verification_required: boolean;
  breadcrumb: string;                // 'l1 → l2 → l3' — extra context
}

interface NodeRow {
  id: string;
  l1: string;
  l2: string | null;
  l3: string | null;
  l4: string | null;
  tab: string;
  home_visit: boolean;
  search_intent_expiry_days: number | null;
  verification_required: boolean;
}

// ─── suggestService ───────────────────────────────────────────────────────────

export async function suggestService(
  input: SuggestInput,
): Promise<SuggestResult[]> {
  const { q, tab, correlationId } = input;

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

  logger.info('suggest.query.start', { correlationId, q, tab: tab ?? null });

  const term = `%${q.trim().toLowerCase()}%`;
  const prefixTerm = `${q.trim().toLowerCase()}%`;
  const validTabs = ['products', 'services', 'expertise', 'establishments'];

  // $queryRawUnsafe is safe here: tab is validated above; term uses parameterised $1/$2/$3.
  // We need $queryRawUnsafe (not $queryRaw) because the tab fragment is injected as SQL,
  // but tab has been allowlisted above — only one of the 4 valid enum values can reach here.
  let nodes: NodeRow[] = [];

  if (tab && validTabs.includes(tab)) {
    nodes = await prisma.$queryRaw<NodeRow[]>`
      SELECT
        id, l1, l2, l3, l4, tab::text AS tab,
        home_visit, search_intent_expiry_days, verification_required
      FROM taxonomy_nodes
      WHERE is_active = true
        AND tab::text = ${tab}
        AND (
          LOWER(l4) LIKE ${term}
          OR LOWER(search_synonyms) LIKE ${term}
        )
      ORDER BY
        CASE WHEN LOWER(l4) LIKE ${prefixTerm} THEN 0 ELSE 1 END,
        l4 ASC
      LIMIT ${maxResults}
    `;
  } else {
    nodes = await prisma.$queryRaw<NodeRow[]>`
      SELECT
        id, l1, l2, l3, l4, tab::text AS tab,
        home_visit, search_intent_expiry_days, verification_required
      FROM taxonomy_nodes
      WHERE is_active = true
        AND (
          LOWER(l4) LIKE ${term}
          OR LOWER(search_synonyms) LIKE ${term}
        )
      ORDER BY
        CASE WHEN LOWER(l4) LIKE ${prefixTerm} THEN 0 ELSE 1 END,
        l4 ASC
      LIMIT ${maxResults}
    `;
  // L3 fallback: if no L4 match, try matching l3 label
  // e.g. "heart doctor" → no L4 → finds "Cardiologist" at L3
  if (nodes.length === 0) {
    const l3Nodes = tab && ['products','services','expertise','establishments'].includes(tab)
      ? await prisma.$queryRaw<NodeRow[]>`
          SELECT DISTINCT ON (l1, l2, l3)
            id, l1, l2, l3, l4, tab::text AS tab,
            home_visit, search_intent_expiry_days, verification_required
          FROM taxonomy_nodes
          WHERE is_active = true AND tab::text = ${tab}
            AND LOWER(l3) LIKE ${term}
          ORDER BY l1, l2, l3, id
          LIMIT ${maxResults}
        `
      : await prisma.$queryRaw<NodeRow[]>`
          SELECT DISTINCT ON (l1, l2, l3)
            id, l1, l2, l3, l4, tab::text AS tab,
            home_visit, search_intent_expiry_days, verification_required
          FROM taxonomy_nodes
          WHERE is_active = true AND LOWER(l3) LIKE ${term}
          ORDER BY l1, l2, l3, id
          LIMIT ${maxResults}
        `;
    if (l3Nodes.length > 0) nodes = l3Nodes;
  }

  const results: SuggestResult[] = nodes
    .filter((node) => node.l4 != null || node.l3 != null)
    .map((node) => ({
      id:                        node.id,
      name:                      node.l4 ?? node.l3 ?? '',
      l1:                        node.l1,
      l2:                        node.l2 ?? null,
      l3:                        node.l3 ?? null,
      l4:                        node.l4 ?? null,
      tab:                       node.tab,
      homeVisit:                 node.home_visit,
      search_intent_expiry_days: node.search_intent_expiry_days ?? null,
      verification_required:     node.verification_required,
      breadcrumb:                [node.l1, node.l2, node.l3].filter(Boolean).join(' → '),
    }));

  logger.info('suggest.query.success', { correlationId, q, returned: results.length });

  return results;
}
