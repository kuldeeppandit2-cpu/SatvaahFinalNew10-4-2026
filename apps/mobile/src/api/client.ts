/**
 * SatvAAh API Client
 * Axios · RS256 JWT Bearer · X-Correlation-ID per request
 * Single-inflight 401 refresh queue · Logout on refresh failure
 * Rule #15: RS256 only — HS256 never used
 * Rule #25: X-Correlation-ID on every request
 */

import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
// react-native-uuid exports a default object; use uuid with random values polyfill
import '../__stubs__/get-random-values';  // must be before uuid
import { v4 as uuidv4 } from 'react-native-uuid';

import { useAuthStore } from '../stores/auth.store';

// ─── Base URL ─────────────────────────────────────────────────────────────────
// All 9 microservices behind a single API gateway / nginx in production.
// In dev each service is on its own port, but mobile always hits the gateway.
console.log("SATVAAAH_URL:", process.env.EXPO_PUBLIC_API_BASE_URL ?? "NOT_SET");
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://192.168.1.3:3000';

// ─── Refresh state ────────────────────────────────────────────────────────────
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void): void {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string): void {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function onRefreshFailed(): void {
  // Reject all pending promises so queued requests don't hang forever
  refreshSubscribers.forEach((cb) => cb(''));
  refreshSubscribers = [];
}

// ─── Client factory ──────────────────────────────────────────────────────────
function createApiClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: BASE_URL,
    timeout: 15_000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Prevent iOS NSURLCache from caching ANY API response.
      // Without these, iOS caches error/empty responses when server is down,
      // then serves stale cache even after server recovers.
      'Cache-Control': 'no-store, no-cache',
      Pragma: 'no-cache',
    },
  });

  // ── Request interceptor — attach token + correlation ID ──────────────────
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      // Rule #25: X-Correlation-ID on every request
      config.headers['X-Correlation-ID'] = uuidv4() as string;

      // Attach RS256 JWT (Rule #15)
      const token = useAuthStore.getState().accessToken;
      if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }

      return config;
    },
    (error) => Promise.reject(error),
  );

  // ── Response interceptor — handle 401 with token refresh ────────────────
  instance.interceptors.response.use(
    (response: AxiosResponse): AxiosResponse => response,
    async (error) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };

      if (error.response?.status !== 401 || originalRequest._retry) {
        return Promise.reject(error);
      }

      // Prevent multiple simultaneous refresh attempts
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          subscribeTokenRefresh((newToken: string) => {
            if (!newToken) {
              reject(new Error('Token refresh failed'));
              return;
            }
            originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
            resolve(instance(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        if (!refreshToken) {
          throw new Error('No refresh token available');
        }

        // Call refresh endpoint directly (avoid interceptor loop)
        const response = await axios.post(
          `${BASE_URL}/api/v1/auth/token/refresh`,
          { refresh_token: refreshToken },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Correlation-ID': uuidv4() as string,
            },
          },
        );

        const { access_token, refresh_token: newRefreshToken } = response.data.data;

        // Persist new tokens
        useAuthStore.getState().refreshAccessToken(access_token, newRefreshToken);

        // Replay all queued requests with new token
        onRefreshed(access_token);
        isRefreshing = false;

        // Replay original request
        originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
        return instance(originalRequest);

      } catch (refreshError) {
        isRefreshing = false;
        onRefreshFailed();

        // Refresh failed — force logout
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      }
    },
  );

  return instance;
}

export const apiClient: AxiosInstance = createApiClient();

// ─── Standard response helpers ────────────────────────────────────────────────
// All endpoints return { success: true, data: {...} } or { success: false, error: {...} }
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    retry_after?: number;
  };
}

export interface ApiPaged<T> {
  success: true;
  data: T[];
  meta: {
    total: number;
    page: number;
    pages: number;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
