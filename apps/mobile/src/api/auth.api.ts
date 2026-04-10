/**
 * SatvAAh Auth API
 * verifyFirebaseToken · refreshTokens · logout
 * Rule #21: consent_given: true is ALWAYS passed — never false, never omitted
 */

import { apiClient, ApiSuccess } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface VerifyFirebasePayload {
  firebaseIdToken: string;
  phone: string;
  mode: 'consumer' | 'provider';
  consent_given: true; // Literal true — Rule #21. DPDP Act 2023 consent record written atomically.
}

export interface VerifyFirebaseResponse {
  access_token: string;
  refresh_token: string;
  userId: string;
  is_new_user: boolean;
  mode: 'consumer' | 'provider';
}

export interface RefreshTokenPayload {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/firebase/verify
 * Called once after Firebase OTP confirmation.
 * consent_given: true ALWAYS (DPDP Act 2023 — Rule #21).
 * On first-time user: atomically INSERTs consent_record + creates user.
 */
export async function verifyFirebaseToken(
  payload: VerifyFirebasePayload,
): Promise<VerifyFirebaseResponse> {
  // Enforce consent_given: true at the type level AND runtime
  // This can never be false — if false, backend returns 400 CONSENT_REQUIRED
  const body: VerifyFirebasePayload = {
    ...payload,
    consent_given: true, // Literal override — never let this be anything else
  };

  const response = await apiClient.post<ApiSuccess<VerifyFirebaseResponse>>(
    '/api/v1/auth/firebase/verify',
    body,
  );

  return response.data.data;
}

/**
 * POST /api/v1/auth/token/refresh
 * Called automatically by Axios interceptor on 401.
 * bcrypt hash of JTI verified server-side (Rule: never raw refresh token in DB).
 */
export async function refreshTokens(
  refreshToken: string,
): Promise<RefreshTokenResponse> {
  const response = await apiClient.post<ApiSuccess<RefreshTokenResponse>>(
    '/api/v1/auth/token/refresh',
    { refresh_token: refreshToken },
  );
  return response.data.data;
}

/**
 * POST /api/v1/auth/logout
 * Adds refresh token JTI to Redis blocklist.
 * Called by auth store logout() after clearing MMKV.
 */
export async function logoutApi(refreshToken: string): Promise<void> {
  try {
    await apiClient.post('/api/v1/auth/logout', { refresh_token: refreshToken });
  } catch {
    // Logout is best-effort — local state cleared regardless
  }
}
