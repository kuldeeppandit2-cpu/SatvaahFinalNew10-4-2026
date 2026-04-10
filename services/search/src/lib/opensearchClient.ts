// services/search/src/lib/opensearchClient.ts
//
// Singleton OpenSearch client for the search service.
// Mirrors the pattern from services/user/src/lib/opensearchClient.ts.
//
// Usage:
//   import { getOpenSearchClient } from './lib/opensearchClient';
//   const client = getOpenSearchClient();

import { Client } from '@opensearch-project/opensearch';
import { logger } from '@satvaaah/logger';

// The single OpenSearch index for all provider documents
export const OPENSEARCH_INDEX = 'satvaaah_providers';

let _client: Client | null = null;

export function getOpenSearchClient(): Client {
  if (_client) return _client;

  const node = process.env.OPENSEARCH_URL ?? 'http://opensearch:9200';
  const username = process.env.OPENSEARCH_USERNAME;
  const password = process.env.OPENSEARCH_PASSWORD;
  const tls = process.env.OPENSEARCH_TLS === 'true';

  const auth =
    username && password ? { username, password } : undefined;

  _client = new Client({
    node,
    auth,
    ssl: tls
      ? {
          // In production set OPENSEARCH_CA_CERT or use Node's default CA store
          rejectUnauthorized: true,
        }
      : undefined,
  });

  logger.info('opensearch.client.initialised', { node });
  return _client;
}
