-- =============================================================================
-- V045: certificate_id_seq
-- Creates the PostgreSQL sequence used by Lambda:certificate-generator
-- to generate the 5-digit sequential part of Certificate IDs.
-- Format: SAT-{CITY}-{YEAR}-{5DIGIT_SEQ} e.g. SAT-HYD-2026-00001
--
-- Why a sequence: atomic, no race condition between concurrent Lambda invocations.
-- Lambda calls: SELECT nextval('certificate_id_seq') inside a transaction.
-- If two Lambdas run simultaneously (edge case), one gets seq N and one gets N+1.
-- UNIQUE constraint on certificate_records.certificate_id is the final safety net.
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS certificate_id_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

COMMENT ON SEQUENCE certificate_id_seq IS
  'Global counter for Certificate of Verification IDs. '
  'Format: SAT-{CITY}-{YEAR}-{LPAD(nextval,5,0)}. '
  'Used by Lambda:certificate-generator only. Never reset.';
