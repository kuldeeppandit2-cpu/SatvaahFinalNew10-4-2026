/**
 * authService.ts — Core authentication logic for SatvAAh auth service (port 3001)
 *
 * Responsibilities:
 *  1. Verify Firebase ID tokens via Admin SDK (phone OTP + email/password for admin)
 *  2. Atomically INSERT new user + consent_record (DPDP Act 2023 compliance)
 *  3. Issue RS256 JWT access tokens (24h) and refresh tokens (30d)
 *  4. Store bcrypt(JTI) in refresh_tokens — NEVER the raw token (Critical Rule #8)
 *  5. Rotate refresh tokens on each use
 *  6. Invalidate tokens on logout (Redis JTI blocklist)
 *  7. Admin JWT with role: 'admin' — admin_users table only (Critical Rule #19)
 *
 * CRITICAL RULES IN FORCE:
 *  #7  — bcrypt cost 12 for all hashing
 *  #8  — Store bcrypt(JTI) in refresh_tokens, never raw token
 *  #15 — RS256 only. NEVER HS256.
 *  #16 — Fail-open on Redis unavailability
 *  #19 — Admin users from admin_users table only. Phone users cannot escalate.
 *  #21 — consent_given boolean REQUIRED; false → 400 CONSENT_REQUIRED
 *  #25 — X-Correlation-ID on every request (passed through, logged)
 */

import * as admin from 'firebase-admin';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '@satvaaah/db';
import { AuthError, NotFoundError, ForbiddenError, ConflictError, ConsentRequiredError } from '@satvaaah/errors';
import { logger } from '@satvaaah/logger';
import { safeRedisGet, safeRedisSetex } from '../redis';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 12; // Critical Rule #7
const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;  // 24 hours
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const JWT_ISSUER = 'satvaaah-auth';

// ---------------------------------------------------------------------------
// Firebase Admin SDK initialisation (idempotent)
// ---------------------------------------------------------------------------

function ensureFirebaseInitialised(): void {
  if (admin.apps.length > 0) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      // docker-compose injects \n as literal \\n — normalise
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });
}

// ---------------------------------------------------------------------------
// JWT key helpers
// ---------------------------------------------------------------------------

let _privateKey: string | null = null;
let _publicKey: string | null = null;

function getPrivateKey(): string {
  if (_privateKey) return _privateKey;
  const raw = process.env.JWT_PRIVATE_KEY;
  if (!raw) throw new Error('JWT_PRIVATE_KEY environment variable is not set');
  _privateKey = raw.replace(/\\n/g, '\n');
  return _privateKey;
}

function getPublicKey(): string {
  if (_publicKey) return _publicKey;
  const raw = process.env.JWT_PUBLIC_KEY;
  if (!raw) throw new Error('JWT_PUBLIC_KEY environment variable is not set');
  _publicKey = raw.replace(/\\n/g, '\n');
  return _publicKey;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenPairResult {
  access_token: string;
  refresh_token: string;
  userId: string;
  is_new_user: boolean;
}

interface UserRow {
  id: string;
  mode: string;
  subscription_tier: string;
  phone_verified: boolean;
  deleted_at?: Date | null;
}

// ---------------------------------------------------------------------------
// Internal: issue a token pair for a given user
// ---------------------------------------------------------------------------

async function issueTokenPair(
  user: UserRow,
  ip: string = 'unknown',
  userAgent: string = 'unknown',
): Promise<Pick<TokenPairResult, 'access_token' | 'refresh_token'>> {
  const privateKey = getPrivateKey();
  const now = Math.floor(Date.now() / 1000);

  // --- Access token ---
  // Payload shape: { iss, sub, exp, iat, mode, subscription_tier, phone_verified, jti }
  // Critical Rule #15: algorithm: 'RS256' — NEVER HS256
  const accessJti = uuidv4();
  const accessPayload = {
    iss: JWT_ISSUER,
    sub: user.id,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: accessJti,
    mode: user.mode,
    subscription_tier: user.subscription_tier,
    phone_verified: user.phone_verified,
  };

  const accessToken = jwt.sign(accessPayload, privateKey, {
    algorithm: 'RS256', // Critical Rule #15
  });

  // --- Refresh token ---
  const refreshJti = uuidv4();
  const refreshPayload = {
    iss: JWT_ISSUER,
    sub: user.id,
    iat: now,
    exp: now + REFRESH_TOKEN_TTL_SECONDS,
    jti: refreshJti,
    type: 'refresh' as const,
  };

  const refreshToken = jwt.sign(refreshPayload, privateKey, {
    algorithm: 'RS256', // Critical Rule #15
  });

  // --- Store bcrypt(JTI) — NEVER the raw token (Critical Rule #8) ---
  const tokenHash = await bcrypt.hash(refreshJti, BCRYPT_ROUNDS);

  await prisma.refreshToken.create({
    data: {
      id: uuidv4(),
      user_id: user.id,
      token_hash: tokenHash, // bcrypt(JTI, 12) — irreversible
      device_id: 'server-issued',
      expires_at: new Date((now + REFRESH_TOKEN_TTL_SECONDS) * 1000),
      ip_address: ip.slice(0, 45),           // IPv6 max 45 chars
      user_agent: userAgent.slice(0, 500),   // VarChar(500) in schema
    },
  });

  return { access_token: accessToken, refresh_token: refreshToken };
}

// ---------------------------------------------------------------------------
// Internal: verify a refresh token JWT and match its JTI against DB
// ---------------------------------------------------------------------------

interface RefreshTokenVerified {
  userId: string;
  jti: string;
  matchedTokenId: string;
  exp: number;
}

async function verifyRefreshToken(refreshToken: string): Promise<RefreshTokenVerified> {
  const publicKey = getPublicKey();

  // 1. Verify RS256 signature + expiry
  let decoded: Record<string, unknown>;
  try {
    decoded = jwt.verify(refreshToken, publicKey, {
      algorithms: ['RS256'], // Critical Rule #15
      issuer: JWT_ISSUER,
    }) as Record<string, unknown>;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthError('TOKEN_EXPIRED', 'Refresh token has expired');
    }
    throw new AuthError('INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  if (decoded.type !== 'refresh') {
    throw new AuthError('INVALID_REFRESH_TOKEN', 'Token is not a refresh token');
  }

  const userId = decoded.sub as string;
  const jti = decoded.jti as string;
  const exp = decoded.exp as number;

  if (!userId || !jti) {
    throw new AuthError('INVALID_REFRESH_TOKEN', 'Token payload is malformed');
  }

  // 2. Check JTI blocklist in Redis (fail-open on Redis unavailability)
  const blocklisted = await safeRedisGet(`jti_blocklist:${jti}`);
  if (blocklisted) {
    throw new AuthError('TOKEN_REVOKED', 'Refresh token has been revoked');
  }

  // 3. Find matching bcrypt(JTI) in DB
  // Query all active refresh tokens for this user, then bcrypt.compare each.
  // O(n) where n = number of active sessions — acceptable (n ≤ ~5 for typical users).
  const storedTokens = await prisma.refreshToken.findMany({
    where: {
      user_id: userId,
      expires_at: { gt: new Date() },
    },
  });

  let matchedTokenId: string | null = null;
  for (const stored of storedTokens) {
    const matches = await bcrypt.compare(jti, stored.token_hash);
    if (matches) {
      matchedTokenId = stored.id;
      break;
    }
  }

  if (!matchedTokenId) {
    throw new AuthError('INVALID_REFRESH_TOKEN', 'Refresh token not found — possibly already used');
  }

  return { user_id: userId, jti, matchedTokenId, exp };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const authService = {
  /**
   * POST /api/v1/auth/firebase/verify
   * Verify Firebase phone OTP token, consent gate, upsert user, issue JWT pair.
   */
  async verifyFirebaseAndIssueTokens(params: {
    firebaseIdToken: string;
    consent_given: boolean;
    ip: string;
    userAgent: string;
    correlationId: string | undefined;
  }): Promise<TokenPairResult> {
    ensureFirebaseInitialised();
    const { firebaseIdToken, consent_given, ip, userAgent, correlationId } = params;

    // --- Consent gate (Critical Rule #21) ---
    if (!consent_given) {
      throw new ConsentRequiredError('User consent is required to proceed (DPDP Act 2023)');
    }

    // --- DEV BYPASS: Mock token for Expo Go/simulator. REMOVE BEFORE PRODUCTION ---
    if (firebaseIdToken === 'MOCK_FIREBASE_TOKEN_FOR_TESTING') {
      const testPhone = '+919000000001';
      let devUser: UserRow;
      let devIsNew = false;
      const devExisting = await prisma.user.findUnique({ where: { phone: testPhone } });
      if (!devExisting) {
        devIsNew = true;
        devUser = await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({ data: { id: uuidv4(), phone: testPhone, phone_verified: true, mode: 'consumer', subscription_tier: 'free', wa_opted_out: false, referral_code: uuidv4().replace(/-/g,'').slice(0,16).toUpperCase() } });
          await tx.consentRecord.create({ data: { id: uuidv4(), user_id: u.id, consent_type: 'dpdp_processing', granted_at: new Date(), ip_address: ip, policy_version: '1.0' } });
          return u;
        });
      } else { devUser = devExisting; }
      // Ensure consumerProfile exists — required for contact events, home screen, messages
      const devConsumerExists = await prisma.consumerProfile.findUnique({ where: { user_id: devUser.id } });
      if (!devConsumerExists) {
        await prisma.consumerProfile.create({
          data: { user_id: devUser.id, display_name: 'Test Consumer' },
        });
        logger.warn('DEV BYPASS: ConsumerProfile created for test user');
      }
      const { access_token, refresh_token } = await issueTokenPair(devUser, ip, userAgent);
      logger.warn('DEV BYPASS: Mock Firebase token accepted — REMOVE BEFORE PRODUCTION');
      return { access_token, refresh_token, userId: devUser.id, user_id: devUser.id, is_new_user: devIsNew, mode: devUser.mode };
    }
    // --- END DEV BYPASS ---

    // --- Verify Firebase token via Admin SDK ---
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(firebaseIdToken, /* checkRevoked */ true);
    } catch (err: any) {
      logger.warn(`Firebase token verification failed`);
      if (err.code === 'auth/id-token-revoked') {
        throw new AuthError('TOKEN_REVOKED', 'Firebase token has been revoked');
      }
      throw new AuthError('INVALID_FIREBASE_TOKEN', 'Firebase token verification failed');
    }

    const phone = decoded.phone_number;
    if (!phone) {
      throw new AuthError(
        'INVALID_FIREBASE_TOKEN',
        'Token does not contain a verified phone number',
      );
    }

    // --- Find or atomically create user + consent record ---
    let user: UserRow;
    let isNewUser = false;

    const existingUser = await prisma.user.findUnique({ where: { phone } });

    // DPDP Act 2023 — soft-deleted users are anonymised within 72h.
    // They must not be able to re-authenticate. Hard fail, not soft fail.
    if (existingUser?.deleted_at) {
      logger.warn(`Login attempt by soft-deleted user: ${existingUser.id}`);
      throw new AuthError('ACCOUNT_DELETED', 'This account has been deleted and cannot be accessed');
    }

    if (!existingUser) {
      isNewUser = true;

      // Atomic INSERT: user + consent_record in single transaction (DPDP Act 2023)
      const newUser = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            id: uuidv4(),
            phone,
            phone_verified: true,
            mode: 'consumer',             // default mode on first sign-in
            subscription_tier: 'free',     // default tier
            wa_opted_out: false,
            referral_code: uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase(), // required unique field
          },
        });

        // DPDP Act 2023 — record explicit consent at registration
        await tx.consentRecord.create({
          data: {
            id: uuidv4(),
            user_id: created.id,
            consent_type: 'dpdp_processing',
            granted_at: new Date(),
            ip_address: ip,
            policy_version: '1.0',
          },
        });

        return created;
      });

      user = newUser;
      logger.info(`New user created`);

      // Create consumerProfile for new user — required for contact events, home screen, messages
      // display_name defaults to phone; consumer profile setup screen updates it on first contact
      await prisma.consumerProfile.create({
        data: { user_id: user.id, display_name: phone },
      });
      logger.info(`ConsumerProfile created for new user`);

    } else {
      user = existingUser;

      // Ensure consumerProfile exists for existing users (covers users created before this fix)
      const cpExists = await prisma.consumerProfile.findUnique({ where: { user_id: user.id } });
      if (!cpExists) {
        await prisma.consumerProfile.create({
          data: { user_id: user.id, display_name: phone },
        });
        logger.info(`ConsumerProfile backfilled for existing user`);
      }

      // Upsert consent record — write if absent (re-login after delete+reinstall)
      const consentExists = await prisma.consentRecord.findFirst({
        where: { user_id: user.id, consent_type: 'dpdp_processing' },
      });

      if (!consentExists) {
        await prisma.consentRecord.create({
          data: {
            id: uuidv4(),
            user_id: user.id,
            consent_type: 'dpdp_processing',
            granted_at: new Date(),
            ip_address: ip,
          },
        });
        logger.info(`Consent record created for existing user`);
      }
    }

    // --- Issue RS256 token pair ---
    const { access_token, refresh_token } = await issueTokenPair(user, ip, userAgent);

    logger.info(`Tokens issued`);

    return {
      access_token,
      refresh_token,
      userId:      user.id,       // mobile reads userId
      user_id:     user.id,       // keep snake_case alias for safety
      is_new_user: isNewUser,
      mode:        user.mode,     // mobile stores mode on first login
    };
  },

  /**
   * POST /api/v1/auth/token/refresh
   * Verify refresh token, rotate it, issue new access token.
   */
  async refreshTokens(
    refreshToken: string,
    ip: string = 'unknown',
    userAgent: string = 'unknown',
  ): Promise<Omit<TokenPairResult, 'is_new_user'>> {
    // 1. Verify + find matching DB record
    const { user_id: userId, matchedTokenId } = await verifyRefreshToken(refreshToken);

    // 2. Load user — check soft-delete
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AuthError('USER_NOT_FOUND', 'User account not found');
    }
    if (user.deleted_at) {
      throw new AuthError('ACCOUNT_DELETED', 'This account has been deleted');
    }

    // 3. Delete old refresh token (rotation — prevents replay)
    await prisma.refreshToken.delete({ where: { id: matchedTokenId } });

    // 4. Issue new token pair
    const { access_token, refresh_token: newRefreshToken } = await issueTokenPair(user, ip, userAgent);

    logger.info(`Tokens rotated for user ${userId}`);

    return {
      access_token,
      refresh_token: newRefreshToken,
      userId:    user.id,
      user_id:   user.id,
    };
  },

  /**
   * POST /api/v1/auth/logout
   * Invalidate refresh token from DB and add access token JTI to Redis blocklist.
   */
  async logout(params: {
    userId: string;
    rawAccessToken: string;
    refreshToken: string | undefined;
    deviceId?: string;
  }): Promise<void> {
    const { userId, rawAccessToken, refreshToken } = params;
    const publicKey = getPublicKey();

    // 1. Decode access token to extract JTI and remaining TTL
    let accessDecoded: Record<string, unknown> | null = null;
    try {
      accessDecoded = jwt.verify(rawAccessToken, publicKey, {
        algorithms: ['RS256'],
        issuer: JWT_ISSUER,
      }) as Record<string, unknown>;
    } catch {
      // Token already expired or invalid — still proceed to invalidate refresh token
      // Try decode without verification to get JTI for blocklist
      try {
        accessDecoded = jwt.decode(rawAccessToken) as Record<string, unknown>;
      } catch {
        accessDecoded = null;
      }
    }

    // 2. Add access token JTI to Redis blocklist (TTL = remaining access token life)
    if (accessDecoded?.jti) {
      const exp = accessDecoded.exp as number | undefined;
      const remainingTTL = exp
        ? Math.max(0, exp - Math.floor(Date.now() / 1000))
        : ACCESS_TOKEN_TTL_SECONDS;

      if (remainingTTL > 0) {
        // fail-open — if Redis is down, blocklist entry is lost (acceptable vs bringing API down)
        await safeRedisSetex(
          `jti_blocklist:${accessDecoded.jti as string}`,
          remainingTTL,
          '1',
        );
      }
    }

    // 3. Invalidate refresh token from DB (best-effort)
    if (refreshToken) {
      try {
        const { matchedTokenId } = await verifyRefreshToken(refreshToken);
        await prisma.refreshToken.delete({ where: { id: matchedTokenId } });
      } catch (err: any) {
        // Best-effort — refresh token may already be expired or invalid
        logger.warn(`Logout: refresh token invalidation skipped`);
      }
    }

    // 4. Purge all expired refresh tokens for this user (housekeeping, opportunistic)
    await prisma.refreshToken
      .deleteMany({
        where: { user_id: userId, expires_at: { lt: new Date() } },
      })
      .catch(() => {
        /* best-effort */
      });

    logger.info(`User logged out`);
  },

  /**
   * POST /api/v1/auth/admin/verify
   * Firebase email+password admin auth. Only admin_users table entries get a JWT.
   * JWT includes role: 'admin'. Critical Rule #19.
   */
  async verifyAdminFirebase(
    firebaseIdToken: string,
  ): Promise<{ access_token: string; userId: string; role: string }> {
    ensureFirebaseInitialised();

    // 1. Verify Firebase token
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(firebaseIdToken, /* checkRevoked */ true);
    } catch (err: any) {
      logger.warn(`Admin Firebase token verification failed`);
      throw new AuthError('INVALID_FIREBASE_TOKEN', 'Firebase token verification failed');
    }

    // 2. Must be email+password sign-in (not phone OTP)
    const signInProvider = decoded.firebase?.sign_in_provider;
    if (signInProvider !== 'password') {
      throw new AuthError(
        'INVALID_AUTH_METHOD',
        'Admin authentication requires email and password',
      );
    }

    const email = decoded.email;
    if (!email) {
      throw new AuthError('INVALID_FIREBASE_TOKEN', 'Token does not contain an email');
    }

    // 3. Authorisation check: email MUST be in admin_users table (Critical Rule #19)
    // Phone-authenticated users can NEVER escalate to admin via this path.
    const adminUser = await prisma.adminUser.findFirst({
      where: {
        email: email.toLowerCase(),
        is_active: true,
      },
    });

    if (!adminUser) {
      // Log with email for audit trail — this is a security event
      logger.warn(`Admin access attempt by non-admin email`);
      throw new AuthError(
        'FORBIDDEN',
        'This account does not have admin privileges',
      );
    }

    // 4. Issue admin JWT (RS256, 24h, includes role: 'admin')
    const privateKey = getPrivateKey();
    const now = Math.floor(Date.now() / 1000);
    const adminJti = uuidv4();

    const adminPayload = {
      iss: JWT_ISSUER,
      sub: adminUser.id,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SECONDS,
      jti: adminJti,
      role: 'admin',
      email: adminUser.email,
    };

    const accessToken = jwt.sign(adminPayload, privateKey, {
      algorithm: 'RS256', // Critical Rule #15
    });

    logger.info(`Admin JWT issued`);

    return { access_token: accessToken, user_id: adminUser.id, role: 'admin' };
  },
};
