/**
 * Slot Controller — /api/v1/providers/:id/slots  +  /api/v1/providers/me/schedule
 *
 * Implements the server side of SlotBookingScreen (Phase 19).
 * SlotBookingScreen was fully built but GET /providers/:id/slots returned [].
 * This controller makes slot booking functional end-to-end.
 *
 * How available slots are calculated for a given date:
 *   Step 1 — provider_availability_slots WHERE day_of_week = date.weekday() AND is_active = TRUE
 *   Step 2 — provider_slot_exceptions WHERE exception_date = date
 *             → is_available=false  → return [] (provider blocked)
 *             → is_available=true   → use override_start/end_time instead of step 1
 *   Step 3 — divide window into slot_duration_minutes chunks
 *   Step 4 — remove chunks where contact_events.slot_date falls in that chunk
 *   Step 5 — return remaining chunks as ProviderSlot[]
 *
 * audit-ref: DB — provider_availability_slots (V050, new table)
 * audit-ref: DB — provider_slot_exceptions    (V050, new table)
 * audit-ref: DB5  contact_events — slot_date field used to mark booked slots
 * audit-ref: L    slot_duration_minutes (system_config key)
 * audit-ref: DB3  provider_profiles — slot_calendar_enabled, taxonomy.default_slot_minutes
 */

import { Request, Response } from 'express';
import { prisma }            from '@satvaaah/db';
import { AppError }          from '@satvaaah/errors';
import { loadSystemConfig }  from '@satvaaah/config';
import { logger }            from '@satvaaah/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProviderSlot {
  slot_time:            string;  // ISO UTC
  slot_duration_minutes: number;
  is_available:          boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse "HH:MM" time string into { hours, minutes }.
 * All times stored in Asia/Kolkata — compared as integers.
 */
function parseHHMM(t: string): { h: number; m: number } {
  const [h, m] = t.split(':').map(Number);
  return { h, m };
}

/**
 * Convert "HH:MM" + a YYYY-MM-DD date string → ISO UTC Date.
 * The date string is in Asia/Kolkata. We build the full IST datetime
 * and convert to UTC for storage / comparison.
 */
function toISTDate(dateStr: string, timeStr: string): Date {
  // dateStr: "2026-04-20", timeStr: "09:00"
  // IST is UTC+5:30 — subtract 5h30m to get UTC
  const [year, month, day] = dateStr.split('-').map(Number);
  const { h, m } = parseHHMM(timeStr);
  // Construct in UTC: IST time minus 5:30
  const utcMs = Date.UTC(year, month - 1, day, h - 5, m - 30);
  return new Date(utcMs);
}

/**
 * Get day-of-week (0=Sun…6=Sat) for a YYYY-MM-DD date string in IST.
 */
function dayOfWeekIST(dateStr: string): number {
  // Parse as local midnight in IST by constructing UTC midnight at IST start
  const [year, month, day] = dateStr.split('-').map(Number);
  // IST midnight = UTC 18:30 previous day → use Date at noon UTC to be safe
  const d = new Date(Date.UTC(year, month - 1, day, 6, 0, 0));
  return d.getDay(); // 0=Sun
}

/**
 * Generate slot start times for a window [startTime, endTime) in slotMinutes steps.
 * Returns array of "HH:MM" strings.
 */
function generateSlots(startTime: string, endTime: string, slotMinutes: number): string[] {
  const start = parseHHMM(startTime);
  const end   = parseHHMM(endTime);
  const startMin = start.h * 60 + start.m;
  const endMin   = end.h   * 60 + end.m;
  const slots: string[] = [];
  for (let t = startMin; t + slotMinutes <= endMin; t += slotMinutes) {
    const hh = String(Math.floor(t / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

// ─── GET /api/v1/providers/:id/slots?date=YYYY-MM-DD ─────────────────────────

/**
 * Returns available slots for a provider on a specific date.
 * Called by SlotBookingScreen — Gold-tier consumer only (enforced in contact flow).
 * This endpoint itself is public (no auth required) so consumer can see calendar
 * before deciding to contact.
 */
export async function getProviderSlots(req: Request, res: Response): Promise<void> {
  const providerId = req.params.id;
  const dateStr    = req.query.date as string;

  // ── Validate inputs ──────────────────────────────────────────────────────
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new AppError('VALIDATION_ERROR', 'date query param required (YYYY-MM-DD)', 400);
  }

  // ── Verify provider exists and has slot calendar enabled ─────────────────
  const provider = await prisma.providerProfile.findUnique({
    where:  { id: providerId },
    select: {
      id:                   true,
      slot_calendar_enabled: true,
      is_active:            true,
      taxonomy_node:        { select: { default_slot_minutes: true } },
    },
  });

  if (!provider || !provider.is_active) {
    throw new AppError('NOT_FOUND', 'Provider not found', 404);
  }

  if (!provider.slot_calendar_enabled) {
    res.json({ success: true, data: [] });
    return;
  }

  // ── Get slot duration (taxonomy override > system_config default) ─────────
  const config       = await loadSystemConfig();
  const systemSlotMin = parseInt(config['slot_duration_minutes'] ?? '30', 10);
  const slotMinutes  = (provider.taxonomy_node?.default_slot_minutes) ?? systemSlotMin;

  // ── Step 1: Get recurring schedule for this day of week ──────────────────
  const dow = dayOfWeekIST(dateStr);

  const scheduleWindows = await prisma.providerAvailabilitySlot.findMany({
    where: { provider_id: providerId, day_of_week: dow, is_active: true },
    select: { start_time: true, end_time: true },
    orderBy: { start_time: 'asc' },
  });

  // ── Step 2: Check for exception on this specific date ────────────────────
  // exception_date is stored as DATE — compare by finding date in IST range
  const excStart = new Date(dateStr + 'T00:00:00+05:30');
  const excEnd   = new Date(dateStr + 'T23:59:59+05:30');

  const exception = await prisma.providerSlotException.findFirst({
    where: {
      provider_id:    providerId,
      exception_date: { gte: excStart, lte: excEnd },
    },
    select: {
      is_available:        true,
      override_start_time: true,
      override_end_time:   true,
    },
  });

  // Fully blocked
  if (exception && !exception.is_available) {
    res.json({ success: true, data: [] });
    return;
  }

  // Determine effective windows
  let effectiveWindows: { start_time: string; end_time: string }[];

  if (exception && exception.is_available &&
      exception.override_start_time && exception.override_end_time) {
    // Exception provides override hours
    effectiveWindows = [{
      start_time: exception.override_start_time,
      end_time:   exception.override_end_time,
    }];
  } else {
    effectiveWindows = scheduleWindows;
  }

  if (effectiveWindows.length === 0) {
    res.json({ success: true, data: [] });
    return;
  }

  // ── Step 3: Generate all possible slot times ──────────────────────────────
  const allSlotTimes: string[] = [];
  for (const w of effectiveWindows) {
    allSlotTimes.push(...generateSlots(w.start_time, w.end_time, slotMinutes));
  }

  if (allSlotTimes.length === 0) {
    res.json({ success: true, data: [] });
    return;
  }

  // ── Step 4: Remove already-booked slots ───────────────────────────────────
  // Get all accepted contact_events with slot_date on this date for this provider
  const dayStart = toISTDate(dateStr, '00:00');
  const dayEnd   = toISTDate(dateStr, '23:59');

  const bookedEvents = await prisma.contactEvent.findMany({
    where: {
      provider_id:  providerId,
      slot_date:    { gte: dayStart, lte: dayEnd },
      status:       { in: ['pending', 'accepted'] },
    },
    select: { slot_date: true },
  });

  // Convert booked slot_dates to "HH:MM" in IST for comparison
  const bookedSlotKeys = new Set(
    bookedEvents
      .filter(e => e.slot_date)
      .map(e => {
        const d = e.slot_date!;
        // Convert UTC → IST (+5:30)
        const istMs  = d.getTime() + 5.5 * 60 * 60 * 1000;
        const istDate = new Date(istMs);
        const hh = String(istDate.getUTCHours()).padStart(2, '0');
        const mm = String(istDate.getUTCMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      }),
  );

  // ── Step 5: Build response ────────────────────────────────────────────────
  const slots: ProviderSlot[] = allSlotTimes.map(slotHHMM => ({
    slot_time:            toISTDate(dateStr, slotHHMM).toISOString(),
    slot_duration_minutes: slotMinutes,
    is_available:         !bookedSlotKeys.has(slotHHMM),
  }));

  logger.debug('getProviderSlots', {
    providerId,
    date:         dateStr,
    dow,
    totalSlots:   slots.length,
    bookedCount:  bookedSlotKeys.size,
  });

  res.json({ success: true, data: slots });
}

// ─── GET /api/v1/providers/me/schedule ───────────────────────────────────────

/**
 * Returns the authenticated provider's recurring weekly schedule.
 * Used by provider dashboard to display / edit their calendar.
 */
export async function getMySchedule(req: Request, res: Response): Promise<void> {
  const userId = (req as any).user!.userId;

  const profile = await prisma.providerProfile.findFirst({
    where:  { user_id: userId },
    select: { id: true },
  });
  if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found', 404);

  const slots = await prisma.providerAvailabilitySlot.findMany({
    where:   { provider_id: profile.id },
    orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }],
    select:  {
      id:          true,
      day_of_week: true,
      start_time:  true,
      end_time:    true,
      is_active:   true,
    },
  });

  res.json({ success: true, data: slots });
}

// ─── PUT /api/v1/providers/me/schedule ───────────────────────────────────────

/**
 * Replaces the provider's entire recurring schedule.
 * Body: { slots: [{ day_of_week, start_time, end_time }] }
 * Atomic: deletes all existing rows then inserts fresh ones in a transaction.
 */
export async function putMySchedule(req: Request, res: Response): Promise<void> {
  const userId = (req as any).user!.userId;
  const { slots } = req.body as {
    slots: { day_of_week: number; start_time: string; end_time: string }[];
  };

  if (!Array.isArray(slots)) {
    throw new AppError('VALIDATION_ERROR', 'slots must be an array', 400);
  }

  // Validate each slot
  for (const s of slots) {
    if (s.day_of_week < 0 || s.day_of_week > 6) {
      throw new AppError('VALIDATION_ERROR', 'day_of_week must be 0-6', 400);
    }
    if (!/^\d{2}:\d{2}$/.test(s.start_time) || !/^\d{2}:\d{2}$/.test(s.end_time)) {
      throw new AppError('VALIDATION_ERROR', 'start_time and end_time must be HH:MM', 400);
    }
    const sp = parseHHMM(s.start_time);
    const ep = parseHHMM(s.end_time);
    if (sp.h * 60 + sp.m >= ep.h * 60 + ep.m) {
      throw new AppError('VALIDATION_ERROR', 'end_time must be after start_time', 400);
    }
  }

  const profile = await prisma.providerProfile.findFirst({
    where:  { user_id: userId },
    select: { id: true },
  });
  if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found', 404);

  // Atomic replace
  const result = await prisma.$transaction(async (tx) => {
    await tx.providerAvailabilitySlot.deleteMany({
      where: { provider_id: profile.id },
    });

    if (slots.length > 0) {
      await tx.providerAvailabilitySlot.createMany({
        data: slots.map(s => ({
          provider_id:  profile.id,
          day_of_week:  s.day_of_week,
          start_time:   s.start_time,
          end_time:     s.end_time,
          is_active:    true,
        })),
      });
    }

    return tx.providerAvailabilitySlot.findMany({
      where:   { provider_id: profile.id },
      orderBy: [{ day_of_week: 'asc' }, { start_time: 'asc' }],
    });
  });

  logger.info('provider.schedule.updated', { providerId: profile.id, slotCount: result.length });
  res.json({ success: true, data: result });
}

// ─── POST /api/v1/providers/me/schedule/exceptions ───────────────────────────

/**
 * Creates or replaces a slot exception for a specific date.
 * Body: { exception_date, is_available, override_start_time?, override_end_time?, note? }
 * Uses upsert — idempotent.
 */
export async function upsertSlotException(req: Request, res: Response): Promise<void> {
  const userId = (req as any).user!.userId;
  const {
    exception_date,
    is_available,
    override_start_time,
    override_end_time,
    note,
  } = req.body;

  // Validate
  if (!exception_date || !/^\d{4}-\d{2}-\d{2}$/.test(exception_date)) {
    throw new AppError('VALIDATION_ERROR', 'exception_date required (YYYY-MM-DD)', 400);
  }
  if (typeof is_available !== 'boolean') {
    throw new AppError('VALIDATION_ERROR', 'is_available must be boolean', 400);
  }
  if (is_available && (!override_start_time || !override_end_time)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'override_start_time and override_end_time required when is_available=true',
      400,
    );
  }

  const profile = await prisma.providerProfile.findFirst({
    where:  { user_id: userId },
    select: { id: true },
  });
  if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found', 404);

  const exceptionDateObj = new Date(exception_date + 'T00:00:00+05:30');

  const result = await prisma.providerSlotException.upsert({
    where: {
      provider_id_exception_date: {
        provider_id:    profile.id,
        exception_date: exceptionDateObj,
      },
    },
    create: {
      provider_id:         profile.id,
      exception_date:      exceptionDateObj,
      is_available,
      override_start_time: is_available ? override_start_time : null,
      override_end_time:   is_available ? override_end_time   : null,
      note:                note ?? null,
    },
    update: {
      is_available,
      override_start_time: is_available ? override_start_time : null,
      override_end_time:   is_available ? override_end_time   : null,
      note:                note ?? null,
    },
    select: {
      id:                  true,
      exception_date:      true,
      is_available:        true,
      override_start_time: true,
      override_end_time:   true,
      note:                true,
    },
  });

  logger.info('provider.slot.exception.upserted', {
    providerId: profile.id,
    exception_date,
    is_available,
  });

  res.status(201).json({ success: true, data: result });
}
