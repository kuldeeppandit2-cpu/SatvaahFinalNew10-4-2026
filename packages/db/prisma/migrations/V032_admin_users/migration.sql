-- =============================================================================
-- V032: admin_users
-- Admin portal users table. Separate from consumer/provider phone OTP users.
-- Auth path: Firebase email+password → admin.verifyIdToken → lookup here.
-- Critical Rule #19: Phone-authenticated users can NEVER escalate to admin.
-- Admin portal: port 3099 (Next.js), VPN-only in production.
-- =============================================================================

CREATE TABLE admin_users (
  id            UUID          NOT NULL DEFAULT gen_random_uuid(),
  email         VARCHAR(255)  NOT NULL,
  display_name  VARCHAR(100)  NOT NULL,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,

  CONSTRAINT admin_users_pkey         PRIMARY KEY (id),
  CONSTRAINT admin_users_email_unique UNIQUE (email)
);

-- Indexes
CREATE INDEX idx_admin_users_email     ON admin_users (email);
CREATE INDEX idx_admin_users_is_active ON admin_users (is_active) WHERE is_active = TRUE;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION set_admin_users_updated_at();

-- Seed the founding admin (Vatsala — irrevocable POA per MASTER_CONTEXT)
-- Password managed via Firebase Auth (email+password). This row is the
-- authorisation check; Firebase verifies the credential.
INSERT INTO admin_users (id, email, display_name, is_active)
VALUES (
  gen_random_uuid(),
  'vatsala@satvaaah.com',
  'Vatsala Pandit',
  TRUE
) ON CONFLICT (email) DO NOTHING;

-- Verification
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE email = 'vatsala@satvaaah.com') THEN
    RAISE EXCEPTION 'V032: admin_users seed failed — founding admin not found';
  END IF;
  RAISE NOTICE 'V032: admin_users table created. Founding admin seeded.';
END $$;
