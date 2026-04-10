#!/usr/bin/env node
/**
 * run-migrations.js
 * Runs all V001..V0XX migration SQL files in order against postgres.
 * Tracks applied migrations in _satvaaah_migrations table.
 * Idempotent: skips already-applied migrations.
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[migrate] FATAL: DATABASE_URL is not set');
  process.exit(1);
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'packages', 'db', 'prisma', 'migrations');

async function run() {
  const client = new Client({ connectionString: DATABASE_URL });
  
  console.log('[migrate] Connecting to database...');
  await client.connect();
  console.log('[migrate] Connected.');

  // Create tracking table
  await client.query(`
    CREATE TABLE IF NOT EXISTS _satvaaah_migrations (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Get list of already-applied migrations
  const applied = await client.query('SELECT name FROM _satvaaah_migrations ORDER BY name');
  const appliedSet = new Set(applied.rows.map(r => r.name));
  console.log(`[migrate] Already applied: ${appliedSet.size} migrations`);

  // Read migration folders sorted by name (V001, V002... natural sort)
  const folders = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => fs.statSync(path.join(MIGRATIONS_DIR, f)).isDirectory())
    .sort();

  let applied_count = 0;
  let skipped_count = 0;

  for (const folder of folders) {
    const sqlFile = path.join(MIGRATIONS_DIR, folder, 'migration.sql');
    
    if (!fs.existsSync(sqlFile)) {
      console.log(`[migrate] SKIP (no SQL): ${folder}`);
      skipped_count++;
      continue;
    }

    if (appliedSet.has(folder)) {
      console.log(`[migrate] SKIP (applied): ${folder}`);
      skipped_count++;
      continue;
    }

    const sql = fs.readFileSync(sqlFile, 'utf8');
    console.log(`[migrate] Applying: ${folder}...`);

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO _satvaaah_migrations (name) VALUES ($1)',
        [folder]
      );
      await client.query('COMMIT');
      console.log(`[migrate] Applied:  ${folder} ✓`);
      applied_count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] FAILED:   ${folder}`);
      console.error(`[migrate] Error: ${err.message}`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`[migrate] Done. Applied: ${applied_count}, Skipped: ${skipped_count}`);
}

run().catch(err => {
  console.error('[migrate] Fatal error:', err.message);
  process.exit(1);
});
