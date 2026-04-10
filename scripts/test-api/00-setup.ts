/**
 * 00-setup.ts — SatvAAh Phase 25b API Test Helpers
 *
 * Shared utilities imported by every test file.
 * No test framework. Plain ts-node + axios + pg + AWS SDK.
 *
 * Required environment variables (set in .env.test or export before running):
 *   FIREBASE_SERVICE_ACCOUNT_PATH   Path to Firebase service account JSON
 *   FIREBASE_API_KEY                Firebase Web API key (for custom token exchange)
 *   ADMIN_EMAIL                     Admin portal user email
 *   ADMIN_PASSWORD                  Admin portal user password
 *   PG_URL                          PostgreSQL connection string (default: localhost:5432)
 *   SQS_ENDPOINT                    Override SQS endpoint (e.g. http://localhost:4566 for LocalStack)
 *   SQS_REGION                      AWS region (default: ap-south-1)
 *   SQS_ACCOUNT_ID                  AWS account ID (for queue URL construction)
 *   FIREBASE_PROJECT_ID             Firebase project ID
 */

import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Client as PgClient } from 'pg';
import {
  SQSClient,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import * as jwt from 'jsonwebtoken';

// ─── Base URLs for all 9 microservices ────────────────────────────────────────
// Port 3008 intentionally absent — does not exist in SatvAAh architecture.

export const BASE = {
  AUTH:         'http://localhost:3001',
  USER:         'http://localhost:3002',
  SEARCH:       'http://localhost:3003',
  TRUST:        'http://localhost:3004',
  RATING:       'http://localhost:3005',
  NOTIFICATION: 'http://localhost:3006',
  PAYMENT:      'http://localhost:3007',
  ADMIN:        'http://localhost:3009',
  SCRAPING:     'http://localhost:3010',
} as const;

// ─── TypeScript interfaces ────────────────────────────────────────────────────

export interface TestUser {
  userId: string;
  accessToken: string;
  refreshToken: string;
  firebaseUid: string;
  testPhone: string;
}

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
  meta?: { total: number; page: number; pages: number };
}

export interface ApiError {
  success: false;
  error: { code: string; message: string; retry_after?: number };
}

// ─── Logging helpers ──────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';

export function log(
  check: string,
  passed: boolean,
  detail?: string,
): void {
  const tag    = passed ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
  const suffix = detail ? ` ${DIM}— ${detail}${RESET}` : '';
  console.log(`  [${tag}] ${check}${suffix}`);
}

export function section(title: string): void {
  console.log(`\n${CYAN}▸ ${title}${RESET}`);
}

/**
 * Assert a condition. On failure, logs FAIL with message and throws so
 * verify-all.sh catches the non-zero exit code.
 */
export function check(
  condition: boolean,
  message: string,
  detail?: string,
): asserts condition {
  log(message, condition, detail);
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}${detail ? ` (${detail})` : ''}`);
  }
}

// ─── X-Correlation-ID (CRITICAL RULE #25) ────────────────────────────────────

export function correlationId(): string {
  return `test-${uuidv4()}`;
}

export function makeHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Correlation-ID': correlationId(),
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

// ─── Axios instance factory ───────────────────────────────────────────────────

export function makeAxios(): AxiosInstance {
  const instance = axios.create({ timeout: 15_000 });
  // Intercept to always attach X-Correlation-ID if missing
  instance.interceptors.request.use((config) => {
    if (!config.headers['X-Correlation-ID']) {
      config.headers['X-Correlation-ID'] = correlationId();
    }
    return config;
  });
  return instance;
}

export const http = makeAxios();

// ─── Firebase Admin initialisation ───────────────────────────────────────────

let firebaseApp: admin.app.App | undefined;

function getFirebaseApp(): admin.app.App {
  if (firebaseApp) return firebaseApp;

  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (saPath) {
    const serviceAccount = JSON.parse(readFileSync(saPath, 'utf8'));
    firebaseApp = admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount) },
      'satvaaah-test',
    );
  } else if (saJson) {
    const serviceAccount = JSON.parse(saJson);
    firebaseApp = admin.initializeApp(
      { credential: admin.credential.cert(serviceAccount) },
      'satvaaah-test',
    );
  } else {
    throw new Error(
      'Firebase service account not configured.\n' +
      'Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON.',
    );
  }

  return firebaseApp;
}

/**
 * Create a Firebase test user (phone-linked) and return a real Firebase ID token.
 * Uses custom token approach so we don't need real OTP flow in CI.
 *
 * Steps:
 *   1. Create (or update) Firebase Auth user with the given phone number.
 *   2. Mint a custom token for that UID.
 *   3. Exchange for ID token via Firebase Auth REST API (signInWithCustomToken).
 */
export async function getFirebaseIdToken(
  uid: string,
  phoneNumber: string,
): Promise<string> {
  const app     = getFirebaseApp();
  const apiKey  = process.env.FIREBASE_API_KEY;
  if (!apiKey) throw new Error('FIREBASE_API_KEY env var required');

  // Ensure user exists in Firebase Auth with phone number
  try {
    await app.auth().updateUser(uid, { phoneNumber });
  } catch (err: unknown) {
    const fbErr = err as { code?: string };
    if (fbErr?.code === 'auth/user-not-found') {
      await app.auth().createUser({ uid, phoneNumber });
    } else {
      throw err;
    }
  }

  // Mint custom token
  const customToken = await app.auth().createCustomToken(uid);

  // Exchange custom token for ID token via REST
  const resp = await axios.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    { token: customToken, returnSecureToken: true },
    { headers: { 'Content-Type': 'application/json' } },
  );

  return resp.data.idToken as string;
}

// ─── Test user lifecycle ──────────────────────────────────────────────────────

const TEST_PHONE_BASE = '+9190000'; // +91 9000 0XXXXX — safe test range

function generateTestPhone(suffix: number): string {
  // e.g. +919000000001 … +919000099999
  return `${TEST_PHONE_BASE}${String(suffix).padStart(5, '0')}`;
}

let _testUserCounter = 1;

/**
 * Create a fresh test user via the auth service.
 * Registers in Firebase Auth then calls POST /api/v1/auth/firebase/verify.
 * Returns user_id, tokens, and test phone for later cleanup.
 */
export async function createTestUser(label = 'user'): Promise<TestUser> {
  const uid    = `test_satvaaah_${label}_${Date.now()}_${_testUserCounter++}`;
  const phone  = generateTestPhone(Date.now() % 99999);
  const idToken = await getFirebaseIdToken(uid, phone);

  const res = await http.post<ApiSuccess<{
    access_token: string;
    refresh_token: string;
    user_id: string;
  }>>(
    `${BASE.AUTH}/api/v1/auth/firebase/verify`,
    { firebaseIdToken: idToken, consent_given: true },
    { headers: makeHeaders() },
  );

  check(res.data.success === true, `createTestUser(${label}): auth success`);
  const { access_token, refresh_token, user_id } = res.data.data;

  return {
    userId:       user_id,
    accessToken:  access_token,
    refreshToken: refresh_token,
    firebaseUid:  uid,
    testPhone:    phone,
  };
}

/**
 * Delete a test user (soft delete via API + Firebase cleanup).
 * Silently skips if user is already gone.
 */
export async function deleteTestUser(user: TestUser): Promise<void> {
  try {
    await http.delete(`${BASE.USER}/api/v1/users/me`, {
      headers: makeHeaders(user.accessToken),
    });
  } catch (_) { /* already deleted or 404 — fine */ }

  try {
    const app = getFirebaseApp();
    await app.auth().deleteUser(user.firebaseUid);
  } catch (_) { /* Firebase user already gone */ }
}

// ─── Admin JWT ────────────────────────────────────────────────────────────────

/**
 * Login to the admin service and return the JWT.
 * Uses POST /api/v1/auth/admin/login (email + password, admin_users table).
 */
export async function getAdminJWT(): Promise<string> {
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD env vars required for admin tests');
  }

  const res = await http.post<ApiSuccess<{ access_token: string; role: string }>>(
    `${BASE.AUTH}/api/v1/auth/admin/login`,
    { email, password },
    { headers: makeHeaders() },
  );
  check(res.data.success === true, 'getAdminJWT: login success');
  return res.data.data.access_token;
}

// ─── JWT decode helper (read claims without verifying signature) ──────────────

export function decodeJwt(token: string): Record<string, unknown> {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Failed to decode JWT');
  }
  return decoded as Record<string, unknown>;
}

// ─── PostgreSQL direct client (for immutability & atomicity checks) ───────────

let pgClient: PgClient | undefined;

export async function getDb(): Promise<PgClient> {
  if (pgClient) return pgClient;

  const url = process.env.PG_URL ?? 'postgresql://satvaaah:satvaaah@localhost:5432/satvaaah';
  pgClient  = new PgClient({ connectionString: url });
  await pgClient.connect();
  return pgClient;
}

export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db  = await getDb();
  const res = await db.query(sql, params);
  return res.rows as T[];
}

export async function closePg(): Promise<void> {
  if (pgClient) {
    await pgClient.end();
    pgClient = undefined;
  }
}

// ─── SQS helper ───────────────────────────────────────────────────────────────

function makeSqsClient(): SQSClient {
  const endpoint = process.env.SQS_ENDPOINT;
  const region   = process.env.SQS_REGION ?? 'ap-south-1';
  return new SQSClient({
    region,
    ...(endpoint ? { endpoint } : {}),
    // In local dev with LocalStack, credentials are dummies
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID     ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });
}

const sqsClient = makeSqsClient();

function sqsQueueUrl(queueName: string): string {
  const endpoint  = process.env.SQS_ENDPOINT ?? 'https://sqs.ap-south-1.amazonaws.com';
  const accountId = process.env.SQS_ACCOUNT_ID ?? '000000000000';
  return `${endpoint}/${accountId}/${queueName}`;
}

/**
 * Return approximate number of in-flight + available messages in the queue.
 * Uses ApproximateNumberOfMessages + ApproximateNumberOfMessagesNotVisible.
 */
export async function sqsGetQueueDepth(queueName: string): Promise<number> {
  const url = sqsQueueUrl(queueName);
  const cmd = new GetQueueAttributesCommand({
    QueueUrl:       url,
    AttributeNames: [
      'ApproximateNumberOfMessages',
      'ApproximateNumberOfMessagesNotVisible',
    ],
  });
  const res = await sqsClient.send(cmd);
  const visible    = parseInt(res.Attributes?.ApproximateNumberOfMessages        ?? '0', 10);
  const inFlight   = parseInt(res.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0', 10);
  return visible + inFlight;
}

/**
 * Send a JSON message body to an SQS queue.
 * Attaches X-Correlation-ID as a MessageAttribute for tracing.
 */
export async function sqsSendMessage(
  queueName: string,
  body: Record<string, unknown>,
): Promise<string> {
  const url     = sqsQueueUrl(queueName);
  const corrId  = correlationId();
  const cmd     = new SendMessageCommand({
    QueueUrl:    url,
    MessageBody: JSON.stringify(body),
    MessageAttributes: {
      'X-Correlation-ID': {
        DataType:    'String',
        StringValue: corrId,
      },
    },
  });
  const res = await sqsClient.send(cmd);
  return res.MessageId ?? '';
}

// ─── City seed helper ─────────────────────────────────────────────────────────

/**
 * Ensure Hyderabad exists in the cities table.
 * Check first; skip INSERT if already present (idempotent).
 * Uses direct DB access because there is no public POST /cities endpoint.
 */
export async function ensureHyderabadCity(): Promise<string> {
  const rows = await dbQuery<{ id: string }>(
    `SELECT id FROM cities WHERE LOWER(name) = 'hyderabad' LIMIT 1`,
  );
  if (rows.length > 0) {
    console.log(`  ${DIM}[SEED] Hyderabad city found (id=${rows[0].id}) — skipping insert${RESET}`);
    return rows[0].id;
  }

  // Insert with a minimal PostGIS boundary polygon centred on Hyderabad
  const insert = await dbQuery<{ id: string }>(`
    INSERT INTO cities (name, state, country, is_active, slug, timezone, centroid)
    VALUES (
      'Hyderabad',
      'Telangana',
      'India',
      true,
      'hyderabad',
      'Asia/Kolkata',
      ST_SetSRID(ST_MakePoint(78.4867, 17.3850), 4326)
    )
    ON CONFLICT (slug) DO UPDATE SET is_active = true
    RETURNING id
  `);

  console.log(`  ${DIM}[SEED] Hyderabad city inserted (id=${insert[0].id})${RESET}`);
  return insert[0].id;
}

// ─── Cleanup registry ─────────────────────────────────────────────────────────

type CleanupFn = () => Promise<void>;
const _cleanups: CleanupFn[] = [];

export function registerCleanup(fn: CleanupFn): void {
  _cleanups.push(fn);
}

export async function runCleanup(): Promise<void> {
  console.log('\n  Running cleanup…');
  for (const fn of _cleanups.reverse()) {
    try { await fn(); } catch (e) { console.warn('  cleanup error:', e); }
  }
  await closePg();
  console.log('  Cleanup done.');
}

/**
 * Wrapper: run test body and always run cleanup, even on failure.
 * Re-throws so the process exits with code 1.
 */
export async function withCleanup(
  testFn: () => Promise<void>,
): Promise<void> {
  try {
    await testFn();
  } finally {
    await runCleanup();
  }
}

// ─── Timing helper ───────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export async function poll<T>(
  fn:          () => Promise<T>,
  predicate:   (val: T) => boolean,
  timeoutMs:   number,
  intervalMs = 500,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (predicate(val)) return val;
    await sleep(intervalMs);
  }
  throw new Error(`poll timed out after ${timeoutMs}ms`);
}

// ─── HTTP error extractor ────────────────────────────────────────────────────

export function extractApiError(err: unknown): { code: string; status: number } {
  if (axios.isAxiosError(err)) {
    const ae = err as AxiosError<ApiError>;
    return {
      code:   ae.response?.data?.error?.code ?? 'UNKNOWN',
      status: ae.response?.status             ?? 0,
    };
  }
  throw err;
}
