/**
 * @package @satvaaah/logger
 * Winston JSON logger with automatic correlation_id injection.
 *
 * CRITICAL RULES — NEVER LOG:
 *   - Aadhaar numbers (any 12-digit number in context should be redacted)
 *   - Passwords or password hashes
 *   - Raw JWT tokens (only log first 8 chars max)
 *   - Full phone numbers (mask last 6 digits: +91****1234)
 *   - DigiLocker UIDs or hashes thereof
 *   - Any PII fields marked as sensitive in DPDP Act 2023
 *
 * Usage:
 *   import { logger } from '@satvaaah/logger';
 *   logger.info('Provider registered', { provider_id, listing_type });
 *   logger.withCorrelationId('uuid').info('...');
 */

import winston from 'winston';
import { AsyncLocalStorage } from 'async_hooks';

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC LOCAL STORAGE — carries correlation_id across async boundaries
// ─────────────────────────────────────────────────────────────────────────────

export const correlationStorage = new AsyncLocalStorage<{ correlationId: string }>();

// ─────────────────────────────────────────────────────────────────────────────
// REDACTION — never log sensitive PII
// ─────────────────────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'hashed_password',
  'token',
  'access_token',
  'accesstoken',         // camelCase 'accessToken' lowercases to this
  'refresh_token',
  'refreshtoken',        // camelCase 'refreshToken'
  'firebase_id_token',
  'firebaseidtoken',     // camelCase 'firebaseIdToken'
  'id_token',
  'idtoken',             // camelCase 'idToken'
  'api_key',
  'apikey',              // camelCase 'apiKey'
  'hashed_key',
  'hashedkey',
  'secret',
  'private_key',
  'privatekey',          // camelCase 'privateKey'
  'jwt_private_key',
  'jwtprivatekey',
  'aadhaar',
  'aadhaar_number',
  'aadhaarnumber',
  'aadhaar_hash',
  'digilocker_uid',
  'digilockeruid',
  'digilocker_code',
  'pan_number',
  'pannumber',
  'otp',
  'card_number',
  'cardnumber',
  'cvv',
  'razorpay_key_secret',
  'razorpaykeysecret',
  'webhook_secret',
  'webhooksecret',
  'fcm_token',           // FCM tokens are device identifiers - should be redacted
  'fcmtoken',
]);

/**
 * Masks a phone number to show only the last 4 digits.
 * +91-9876543210 → +91-******3210
 * Never logs full phone numbers per DPDP Act 2023.
 */
function maskPhone(phone: string): string {
  // Normalise to digits only, then mask all but last 4, preserving country code.
  // +919876543210  → +91******3210
  // +91 98765 43210 → +91******3210
  // 9876543210     → ******3210
  const digits = phone.replace(/\D/g, '');
  if (digits.length > 10) {
    // International format: first 2 digits are country code (e.g. '91' for India)
    const cc = digits.slice(0, 2);
    const national = digits.slice(2);
    return `+${cc}${'*'.repeat(national.length - 4)}${national.slice(-4)}`;
  }
  if (digits.length > 4) {
    // Domestic format: no country code prefix
    return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
  }
  return '****';
}

/**
 * Recursively redacts sensitive fields in log metadata objects.
 * Also detects 12-digit Aadhaar patterns and redacts them.
 */
function redact(obj: unknown, depth = 0): unknown {
  if (depth > 10) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Redact Aadhaar patterns: 12 consecutive digits (possibly spaced)
    const aadhaarPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
    if (aadhaarPattern.test(obj)) {
      return '[AADHAAR_REDACTED]';
    }
    return obj;
  }

  if (typeof obj === 'number') return obj;
  if (typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      if (SENSITIVE_KEYS.has(lowerKey)) {
        // Show first 8 chars of tokens for debugging, fully redact others
        if (lowerKey.includes('token') && typeof value === 'string' && value.length > 8) {
          result[key] = `${value.slice(0, 8)}...[REDACTED]`;
        } else {
          result[key] = '[REDACTED]';
        }
      } else if (lowerKey === 'phone' || lowerKey.includes('phone_number')) {
        result[key] = typeof value === 'string' ? maskPhone(value) : '[PHONE_REDACTED]';
      } else {
        result[key] = redact(value, depth + 1);
      }
    }
    return result;
  }

  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATS
// ─────────────────────────────────────────────────────────────────────────────

const redactFormat = winston.format((info) => {
  // Redact top-level metadata
  const { level, message, timestamp, ...meta } = info;
  const redacted = redact(meta) as Record<string, unknown>;

  // Inject correlation_id from AsyncLocalStorage
  const store = correlationStorage.getStore();
  const correlationId = store?.correlationId ?? info.correlation_id ?? 'unknown';

  return {
    ...redacted,
    level,
    message: typeof message === 'string' ? message : JSON.stringify(message),
    timestamp,
    correlation_id: correlationId,
    service: process.env.SERVICE_NAME ?? 'satvaaah',
    env: process.env.NODE_ENV ?? 'development',
  };
})();

const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  redactFormat,
  winston.format.json(),
);

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  redactFormat,
  winston.format.printf(({ timestamp, level, message, correlation_id, ...meta }) => {
    const metaStr = Object.keys(meta).length
      ? ` ${JSON.stringify(meta, null, 0)}`
      : '';
    return `${timestamp} [${correlation_id}] ${level}: ${message}${metaStr}`;
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// WINSTON INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug');

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProduction ? jsonFormat : devFormat,
    handleExceptions: true,
    handleRejections: true,
  }),
];

// In production, also write errors to stderr stream for CloudWatch
if (isProduction) {
  transports.push(
    new winston.transports.Console({
      level: 'error',
      stderrLevels: ['error'],
      format: jsonFormat,
    }),
  );
}

const winstonLogger = winston.createLogger({
  level: logLevel,
  transports,
  exitOnError: false,
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC LOGGER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface LogMeta extends Record<string, unknown> {
  correlation_id?: string;
  provider_id?: string;
  consumer_id?: string;
  user_id?: string;
  request_id?: string;
  service?: string;
  error_code?: string;
  http_status?: number;
  duration_ms?: number;
  path?: string;
  method?: string;
}

export const logger = {
  debug(message: string, meta?: LogMeta): void {
    winstonLogger.debug(message, meta);
  },
  info(message: string, meta?: LogMeta): void {
    winstonLogger.info(message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    winstonLogger.warn(message, meta);
  },
  error(message: string, meta?: LogMeta & { error?: unknown }): void {
    const { error, ...rest } = meta ?? {};
    if (error instanceof Error) {
      winstonLogger.error(message, {
        ...rest,
        error_name: error.name,
        error_message: error.message,
        // Stack trace only in non-production
        ...(isProduction ? {} : { stack: error.stack }),
      });
    } else {
      winstonLogger.error(message, meta);
    }
  },

  /**
   * Creates a child logger with a specific correlation_id bound.
   * Use in middlewares that have the id before the AsyncLocalStorage is set.
   */
  withCorrelationId(correlationId: string) {
    return {
      debug: (message: string, meta?: LogMeta) =>
        winstonLogger.debug(message, { ...meta, correlation_id: correlationId }),
      info: (message: string, meta?: LogMeta) =>
        winstonLogger.info(message, { ...meta, correlation_id: correlationId }),
      warn: (message: string, meta?: LogMeta) =>
        winstonLogger.warn(message, { ...meta, correlation_id: correlationId }),
      error: (message: string, meta?: LogMeta) =>
        winstonLogger.error(message, { ...meta, correlation_id: correlationId }),
    };
  },

  /** Wraps an async callback in AsyncLocalStorage with the given correlationId. */
  runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
    return correlationStorage.run({ correlationId }, fn);
  },
};

export default logger;
