/**
 * apps/mobile/src/api/contact.api.ts
 * SatvAAh Phase 19 — Contact Flow API
 *
 * Covers (MASTER_CONTEXT KEY API ENDPOINTS — user :3002):
 *   POST   /api/v1/contact-events               — create call / message / slot_booking
 *   POST   /api/v1/contact-events/:id/no-show   — report no-show
 *   GET    /api/v1/messages/:event_id            — REST catchup on WS reconnect
 *   POST   /api/v1/messages                      — send message
 *   GET    /api/v1/saved-providers               — consumer saved list
 *   POST   /api/v1/saved-providers               — save a provider
 *   DELETE /api/v1/saved-providers/:id           — unsave a provider
 *
 * CRITICAL RULES (MASTER_CONTEXT):
 *   • contact_lead_cost = 0 at launch — never hardcode cost UI; always read from response
 *   • Provider phone always visible — no reveal gate
 *   • Slot booking: Gold tier consumer only + provider must have published calendar
 *   • Consumer phone revealed to provider on accept (not the other way round)
 *   • All amounts in PAISE (integer) — never float, never rupees
 *   • API response format: { success: true, data: {...} } or { success: false, error: {...} }
 */

import { apiClient } from './client';

// ─── Enums ───────────────────────────────────────────────────────────────────

export type ContactType = 'call' | 'message' | 'slot_booking';
export type ContactStatus = 'pending' | 'accepted' | 'declined' | 'expired';
export type ProviderAction = 'accept' | 'decline';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateContactEventDto {
  providerId: string;
  contactType: ContactType;
  slot_time?: string;       // ISO UTC — slot_booking only
  message_text?: string;    // message type — optional initial message
}

export interface ContactEvent {
  id: string;
  consumerId: string;
  providerId: string;
  contactType: ContactType;
  status: ContactStatus;
  providerStatus: ProviderAction | null;
  consumerLeadDeducted: boolean;
  provider_phone_revealed: boolean;
  provider_phone: string;    // always returned — MASTER_CONTEXT: provider phone always visible
  contact_lead_cost: number; // paise — 0 at launch; never hardcode UI off this
  slot_time?: string;        // ISO UTC if slot_booking
  createdAt: string;
  updatedAt: string;
}

export interface InAppMessage {
  id: string;
  contactEventId: string;
  sender_id: string;
  message_text: string | null;
  photo_url: string | null;   // S3 URL — uploaded directly via presigned PUT
  sentAt: string;            // UTC
  deliveredAt: string | null;
  readAt: string | null;
}

export interface SendMessageDto {
  contactEventId: string;
  message_text?: string;
  photo_url?: string;         // S3 URL after direct PUT upload
}

export interface PresignedUrlResponse {
  upload_url: string;         // S3 presigned PUT URL — PUT directly, no Authorization header
  photo_url: string;          // Final S3 URL to store in message
  key: string;
  expires_in: number;         // seconds
}

export interface ProviderSlot {
  slot_time: string;          // ISO UTC
  slot_duration_minutes: number; // from system_config slot_duration_minutes — never hardcode
  is_available: boolean;
}

export interface SavedProvider {
  providerId: string;
  saved_at: string;
  trust_score_at_save: number;
  provider: {
    id: string;
    displayName: string;
    listingType: string;
    tab: string;
    trustScore: number;
    trustTier: string;
    cityId: string | null;
    primary_taxonomy_label: string;
    photoUrl: string | null;
    cityName: string | null;
    areaName: string | null;
  };
  photo_url: string | null;
  saved_at: string;
}

// ─── Contact Events ───────────────────────────────────────────────────────────

/**
 * POST /api/v1/contact-events
 * Creates a contact event (call / message / slot_booking).
 * Slot booking requires contact_type=slot_booking + slot_time (ISO UTC).
 * Backend handles lead deduction and FCM push to provider.
 */
export async function createContactEvent(dto: CreateContactEventDto): Promise<ContactEvent> {
  const { data } = await apiClient.post('/api/v1/contact-events', dto);
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to create contact event');
  return data.data as ContactEvent;
}

/**
 * POST /api/v1/contact-events/:id/no-show
 * Consumer reports provider no-show.
 * Backend: trust penalty + lead refund + priority reroute offered.
 */
export async function reportNoShow(eventId: string): Promise<void> {
  const { data } = await apiClient.post(`/api/v1/contact-events/${eventId}/no-show`);
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to report no-show');
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/messages/:event_id
 * REST catchup — called on WebSocket reconnect to fetch missed messages.
 * Returns messages in ascending sent_at order.
 */
export async function getMessages(eventId: string): Promise<InAppMessage[]> {
  const { data } = await apiClient.get(`/api/v1/messages/${eventId}`);
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to load messages');
  return data.data as InAppMessage[];
}

/**
 * POST /api/v1/messages
 * Send a message. photo_url must already be uploaded to S3 via presigned URL.
 * At least one of message_text or photo_url must be present.
 */
export async function sendMessage(dto: SendMessageDto): Promise<InAppMessage> {
  const { data } = await apiClient.post('/api/v1/messages', dto);
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to send message');
  return data.data as InAppMessage;
}

// ─── Photo Upload (binary never touches Node servers) ─────────────────────────

/**
 * POST /api/v1/uploads/presigned-url
 * Get a presigned S3 PUT URL for photo upload.
 * After receiving, PUT the file directly to upload_url — no Authorization header.
 * Then pass photo_url to sendMessage().
 */
export async function getPhotoUploadUrl(
  mimeType: 'image/jpeg' | 'image/png',
  context: 'message' | 'profile' | 'credential',
): Promise<PresignedUrlResponse> {
  const { data } = await apiClient.post('/api/v1/uploads/presigned-url', {
    mimeType,
    context,
  });
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to get upload URL');
  return data.data as PresignedUrlResponse;
}

/**
 * PUT directly to S3 presigned URL.
 * No Authorization header — S3 presigned URLs are self-authenticating.
 * Returns the photo_url for use in sendMessage().
 */
export async function uploadPhotoToS3(
  uploadUrl: string,
  localUri: string,
  mimeType: 'image/jpeg' | 'image/png',
): Promise<void> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  // PUT directly to S3 — explicitly no Authorization header
  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: blob,
  });
}

// ─── Slots (Gold tier only) ───────────────────────────────────────────────────

/**
 * GET /api/v1/providers/:id/slots?date=YYYY-MM-DD
 * Returns available slots for a provider on a given date.
 * Slot booking gated: Gold tier consumer + provider must have published calendar.
 * Backend returns 403 for non-Gold consumers (defence-in-depth — UI also gates).
 */
export async function getProviderSlots(
  providerId: string,
  date: string, // YYYY-MM-DD in Asia/Kolkata
): Promise<ProviderSlot[]> {
  // TODO: Slot booking not yet implemented server-side (Phase 24)
  // When implemented: GET /api/v1/providers/${providerId}/slots?date=${date}
  return [];
}

// ─── Saved Providers ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/saved-providers
 * Consumer's saved provider list.
 */
export async function getSavedProviders(): Promise<SavedProvider[]> {
  const { data } = await apiClient.get('/api/v1/saved-providers');
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to load saved providers');
  // Backend returns { data: { providers: [...], total: N } }
  const items = Array.isArray(data.data) ? data.data : (data.data?.providers ?? []);
  return items as SavedProvider[];
}

/**
 * POST /api/v1/saved-providers
 */
export async function saveProvider(providerId: string): Promise<SavedProvider> {
  const { data } = await apiClient.post('/api/v1/saved-providers', { provider_id: providerId });
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to save provider');
  return data.data as SavedProvider;
}

/**
 * DELETE /api/v1/saved-providers/:id
 * :id is the saved_providers row id (from getSavedProviders), not the provider_id.
 */
export async function unsaveProvider(savedId: string): Promise<void> {
  const { data } = await apiClient.delete(`/api/v1/saved-providers/${savedId}`);
  if (!data.success) throw new Error(data.error?.message ?? 'Failed to unsave provider');
}
