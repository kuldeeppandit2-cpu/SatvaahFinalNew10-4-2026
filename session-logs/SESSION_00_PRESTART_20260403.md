# SESSION_00_PRESTART_20260403

## What was completed before coding began
- All 4 architecture documents reviewed (User Journey v3, Taxonomy Master v2, Architecture v1, GitHub Structure v1)
- Full coherence review — 8 findings, all resolved
- Documents corrected: Architecture v2, User Journey v2, GitHub Structure v2
- MASTER_CONTEXT.md created — permanent project brain
- GitHub repo structure created and verified — 194 files, all correct

## Verified repo structure
- services/auth/ port 3001
- services/user/ port 3002
- services/search/ port 3003
- services/trust/ port 3004
- services/rating/ port 3005
- services/notification/ port 3006
- services/payment/ port 3007
- services/admin/ port 3009
- services/scraping/ port 3010 (Python)
- NO booking service. NO provider service. NO port 3008.
- apps/mobile/ — React Native (Expo SDK 51)
- apps/admin-web/ — Next.js 14, port 3099
- lambdas/ — 9 Lambda functions
- packages/ — db, types, errors, middleware, logger, config
- packages/db/prisma/migrations/ — V001 through V031 (V012 EXISTS)
- session-logs/ — this file

## All coherence corrections applied
1. Branch.io replaces Firebase Dynamic Links (deprecated Aug 2025)
2. Trust tier Basic threshold = 20 (NOT 40)
3. WhatsApp template 16 (provider_final_reminder_7d) added
4. Prisma only — no Flyway anywhere
5. consent_given: boolean required in POST /auth/firebase/verify
6. apps/admin-web/ present in repo
7. V029, V030, V031 present in migrations
8. V012 = search_intents — EXISTS, not deleted

## Current state of all services
auth:          NOT STARTED
user:          NOT STARTED
search:        NOT STARTED
trust:         NOT STARTED
rating:        NOT STARTED
notification:  NOT STARTED
payment:       NOT STARTED
admin:         NOT STARTED
scraping:      NOT STARTED

## NEXT SESSION — EXACT PROMPT TO USE
Upload MASTER_CONTEXT.md and this file. Then say:

TODAY'S TASK: Phase 0 — Session 1. 
Write docker-compose.yml with all 9 services on their correct ports
(auth:3001, user:3002, search:3003, trust:3004, rating:3005,
notification:3006, payment:3007, admin:3009, scraping:3010),
shared network satvaaah-net, named volumes for PostgreSQL, Redis,
MongoDB, OpenSearch, health checks on all DB containers, hot reload
via nodemon for all Node.js services.
Then write .env.example with every required environment variable.
Give me the terminal command to verify all containers start correctly.
