-- =============================================================================
-- SatvAAh — PostgreSQL Init Script
-- Runs once on first container start (docker-entrypoint-initdb.d)
-- =============================================================================

-- Create shadow database for Prisma migrate dev
SELECT 'CREATE DATABASE satvaaah_shadow OWNER satvaaah_user'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'satvaaah_shadow')
\gexec

-- Enable extensions on main database
\c satvaaah;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Grant all privileges to app user
GRANT ALL PRIVILEGES ON DATABASE satvaaah TO satvaaah_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO satvaaah_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO satvaaah_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO satvaaah_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO satvaaah_user;

-- Enable extensions on shadow database
\c satvaaah_shadow;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

GRANT ALL PRIVILEGES ON DATABASE satvaaah_shadow TO satvaaah_user;
