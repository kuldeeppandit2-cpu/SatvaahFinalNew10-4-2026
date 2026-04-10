BEGIN;
ALTER TABLE scraping_staging ADD COLUMN IF NOT EXISTS website_url TEXT;
ALTER TABLE scraping_staging ADD COLUMN IF NOT EXISTS photos JSONB;
ALTER TABLE scraping_staging ADD COLUMN IF NOT EXISTS opening_hours JSONB;
ALTER TABLE scraping_staging ADD COLUMN IF NOT EXISTS external_rating NUMERIC(3,2);
ALTER TABLE scraping_staging ADD COLUMN IF NOT EXISTS external_review_count INT;
ALTER TABLE scraping_staging ADD COLUMN IF NOT EXISTS social_links JSONB;
ALTER TABLE scraping_staging ADD COLUMN IF NOT EXISTS certificates_found JSONB;
COMMIT;
