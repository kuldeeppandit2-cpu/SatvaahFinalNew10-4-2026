/**
 * @package @satvaaah/errors
 * Centralised error hierarchy for all 9 SatvAAh microservices.
 *
 * Every error has:
 *   code        — machine-readable string (used in API responses)
 *   message     — user-facing message (safe to expose)
 *   httpStatus  — mapped by errorHandler middleware
 *
 * RULE: Stack traces NEVER exposed in production (errorHandler enforces this).
 */

// ─────────────────────────────────────────────────────────────────────────────
// BASE CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly isOperational: boolean;

  constructor(code: string, message: string, httpStatus: number, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.isOperational = isOperational;

    // Maintain proper prototype chain in transpiled JS
    Object.setPrototypeOf(this, new.target.prototype);

    // Only capture stack in development (never expose in production)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ERRORS — 401
// ─────────────────────────────────────────────────────────────────────────────

export class AuthError extends AppError {
  constructor(
    code = 'AUTH_ERROR',
    message = 'Authentication required',
    httpStatus = 401,
  ) {
    super(code, message, httpStatus);
  }
}

export class TokenExpiredError extends AuthError {
  constructor(message = 'Access token has expired') {
    super('TOKEN_EXPIRED', message, 401);
  }
}

export class TokenInvalidError extends AuthError {
  constructor(message = 'Invalid or malformed token') {
    super('TOKEN_INVALID', message, 401);
  }
}

export class TokenRevokedError extends AuthError {
  constructor() {
    super('TOKEN_REVOKED', 'Token has been revoked — please log in again', 401);
  }
}

export class TokenMissingError extends AuthError {
  constructor(message = 'Authorization token is required') {
    super('TOKEN_MISSING', message, 401);
  }
}

export class FirebaseTokenError extends AuthError {
  constructor(message = 'Firebase ID token verification failed') {
    super('FIREBASE_TOKEN_INVALID', message, 401);
  }
}

export class ConsentRequiredError extends AuthError {
  constructor(message = 'Consent to data processing is required to use SatvAAh') {
    super('CONSENT_REQUIRED', message, 400);
  }
}

export class PhoneNotVerifiedError extends AuthError {
  constructor(message = 'Phone number verification is required') {
    super('PHONE_NOT_VERIFIED', message, 403);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORISATION ERRORS — 403
// ─────────────────────────────────────────────────────────────────────────────

export class ForbiddenError extends AppError {
  constructor(
    code = 'FORBIDDEN',
    message = 'You do not have permission to perform this action',
  ) {
    super(code, message, 403);
  }
}

export class AdminRequiredError extends ForbiddenError {
  constructor(message = 'Admin access is required') {
    super('ADMIN_REQUIRED', message);
  }
}

export class ModeRequiredError extends ForbiddenError {
  constructor(requiredMode: string) {
    super(
      'MODE_REQUIRED',
      `You must be in ${requiredMode} mode to perform this action`,
    );
  }
}

export class SubscriptionRequiredError extends ForbiddenError {
  constructor(requiredTier: string) {
    super(
      'SUBSCRIPTION_REQUIRED',
      `This feature requires a ${requiredTier} subscription`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMIT ERRORS — 429
// ─────────────────────────────────────────────────────────────────────────────

export class RateLimitError extends AppError {
  public readonly retryAfter: number; // seconds

  constructor(
    code = 'RATE_LIMIT_EXCEEDED',
    message = 'Too many requests. Please try again later.',
    retryAfter = 60,
  ) {
    super(code, message, 429);
    this.retryAfter = retryAfter;
  }
}

export class DailyRatingLimitError extends RateLimitError {
  constructor(tab: string, limit: number) {
    super(
      'DAILY_RATING_LIMIT_EXCEEDED',
      `You have reached the daily rating limit of ${limit} for ${tab}`,
      86400, // retry after 24h
    );
  }
}

export class LeadLimitExceededError extends RateLimitError {
  constructor(message = 'Monthly lead limit reached. Upgrade your plan for more leads.') {
    super('LEAD_LIMIT_EXCEEDED', message, 2592000); // 30 days in seconds — next billing cycle
  }
}

export class InsufficientLeadsError extends AppError {
  constructor(current: number, required: number) {
    super(
      'INSUFFICIENT_LEADS',
      `Insufficient lead credits. You have ${current} but this requires ${required}. Please upgrade your subscription.`,
      402,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOT FOUND ERRORS — 404
// ─────────────────────────────────────────────────────────────────────────────

export class NotFoundError extends AppError {
  constructor(resource = 'Resource', id?: string, code = 'NOT_FOUND') {
    const message = id
      ? `${resource} with id '${id}' was not found`
      : `${resource} not found`;
    super(code, message, 404);
  }
}

export class ProviderNotFoundError extends NotFoundError {
  constructor(id?: string) {
    super('Provider', id, 'PROVIDER_NOT_FOUND');
  }
}

export class UserNotFoundError extends NotFoundError {
  constructor(id?: string) {
    super('User', id, 'USER_NOT_FOUND');
  }
}

export class TrustScoreNotFoundError extends NotFoundError {
  constructor(providerId: string) {
    super('Trust score', providerId, 'TRUST_SCORE_NOT_FOUND');
  }
}

export class ContactEventNotFoundError extends NotFoundError {
  constructor(id?: string) {
    super('Contact event', id, 'CONTACT_EVENT_NOT_FOUND');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFLICT ERRORS — 409
// ─────────────────────────────────────────────────────────────────────────────

export class ConflictError extends AppError {
  constructor(code = 'CONFLICT', message = 'Resource already exists or conflicts with current state') {
    super(code, message, 409);
  }
}

export class DuplicateProviderError extends ConflictError {
  constructor(phone: string) {
    // Never log full phone number — mask it
    const masked = phone.length > 4
      ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`
      : '****';
    super('DUPLICATE_PROVIDER', `A provider account with phone ${masked} already exists`);
  }
}

export class DuplicateRatingError extends ConflictError {
  constructor() {
    super('DUPLICATE_RATING', 'You have already submitted a rating for this provider today');
  }
}

export class AlreadySavedError extends ConflictError {
  constructor() {
    super('ALREADY_SAVED', 'Provider is already in your saved list');
  }
}

export class CertificateAlreadyIssuedError extends ConflictError {
  constructor() {
    super('CERTIFICATE_ALREADY_ISSUED', 'Certificate has already been issued for this provider');
  }
}

export class IdempotencyConflictError extends ConflictError {
  constructor() {
    super('IDEMPOTENCY_CONFLICT', 'A request with this idempotency key is already being processed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION ERRORS — 400
// ─────────────────────────────────────────────────────────────────────────────

export class ValidationError extends AppError {
  public readonly fields?: Record<string, string>;

  constructor(
    code = 'VALIDATION_ERROR',
    message = 'Request validation failed',
    fields?: Record<string, string>,
  ) {
    super(code, message, 400);
    this.fields = fields;
  }
}

export class MissingFieldError extends ValidationError {
  constructor(fieldName: string) {
    super('MISSING_FIELD', `Required field '${fieldName}' is missing`);
  }
}

export class InvalidFieldError extends ValidationError {
  constructor(fieldName: string, reason?: string) {
    super('INVALID_FIELD', reason ? `Field '${fieldName}': ${reason}` : `Field '${fieldName}' is invalid`);
  }
}

export class InvalidEnumError extends ValidationError {
  constructor(fieldName: string, validValues: string[]) {
    super('INVALID_ENUM', `Field '${fieldName}' must be one of: ${validValues.join(', ')}`);
  }
}

export class InvalidCoordinatesError extends ValidationError {
  constructor() {
    super('INVALID_COORDINATES', 'Invalid latitude/longitude coordinates');
  }
}

export class AadhaarForbiddenError extends ValidationError {
  constructor() {
    super('AADHAAR_FORBIDDEN', 'Aadhaar numbers must never be submitted directly. Use DigiLocker verification.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT ERRORS — 402 / 400
// ─────────────────────────────────────────────────────────────────────────────

export class PaymentError extends AppError {
  constructor(
    code = 'PAYMENT_ERROR',
    message = 'Payment processing failed',
    httpStatus = 402,
  ) {
    super(code, message, httpStatus);
  }
}

export class WebhookSignatureError extends PaymentError {
  constructor() {
    super('WEBHOOK_SIGNATURE_INVALID', 'Razorpay webhook signature verification failed', 400);
  }
}

export class PaymentOrderNotFoundError extends PaymentError {
  constructor(orderId: string) {
    super('PAYMENT_ORDER_NOT_FOUND', `Razorpay order ${orderId} not found`, 404);
  }
}

export class SubscriptionNotActiveError extends PaymentError {
  constructor() {
    super('SUBSCRIPTION_NOT_ACTIVE', 'No active subscription found for this user', 402);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL SERVICE ERRORS — 502 / 503
// ─────────────────────────────────────────────────────────────────────────────

export class ExternalServiceError extends AppError {
  constructor(service: string, message?: string) {
    super(
      'EXTERNAL_SERVICE_ERROR',
      message ?? `External service '${service}' is temporarily unavailable`,
      502,
      true, // operational — external dependency failed, not our bug
    );
  }
}

export class DigiLockerError extends ExternalServiceError {
  constructor(message?: string) {
    super('DigiLocker', message ?? 'DigiLocker verification service is unavailable');
    Object.defineProperty(this, 'code', { value: 'DIGILOCKER_ERROR' });
  }
}

export class FirebaseServiceError extends ExternalServiceError {
  constructor(message?: string) {
    super('Firebase', message ?? 'Firebase authentication service is unavailable');
    Object.defineProperty(this, 'code', { value: 'FIREBASE_SERVICE_ERROR' });
  }
}

export class OpenSearchError extends ExternalServiceError {
  constructor(message?: string) {
    super('OpenSearch', message);
    Object.defineProperty(this, 'code', { value: 'OPENSEARCH_ERROR' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL / PROGRAMMING ERRORS — 500
// ─────────────────────────────────────────────────────────────────────────────

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred') {
    super('INTERNAL_ERROR', message, 500, false); // not operational
  }
}

export class ConfigurationError extends AppError {
  constructor(key: string) {
    super(
      'CONFIGURATION_ERROR',
      `Required configuration key '${key}' is missing or invalid`,
      500,
      false,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUST / BUSINESS RULE ERRORS
// ─────────────────────────────────────────────────────────────────────────────

export class RatingNotEligibleError extends AppError {
  constructor(reason: string) {
    super('RATING_NOT_ELIGIBLE', reason, 403);
  }
}

export class ContactEventRequiredError extends AppError {
  constructor() {
    super(
      'CONTACT_EVENT_REQUIRED',
      'A contact event is required to rate this provider type',
      403,
    );
  }
}

export class LeadAlreadyActedError extends AppError {
  constructor() {
    super('LEAD_ALREADY_ACTED', 'This lead has already been accepted or declined', 409);
  }
}

export class SlotBookingRequiresGoldError extends AppError {
  constructor() {
    super(
      'SLOT_BOOKING_REQUIRES_GOLD',
      'Slot booking is only available for Gold subscription tier',
      403,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE GUARD
// ─────────────────────────────────────────────────────────────────────────────

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function isOperationalError(err: unknown): boolean {
  if (isAppError(err)) return err.isOperational;
  return false;
}
