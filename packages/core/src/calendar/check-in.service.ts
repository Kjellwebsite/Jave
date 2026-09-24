import { eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { eventRsvps, events } from '@jave/database';
import { type ServiceContext, withTransaction } from '../kernel/context';
import { randomCode, safeEqual, sha256Hex } from '../kernel/crypto';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { parseInput } from '../kernel/validation';
import { recordAudit } from '../audit/audit.service';
import { publishEvent } from '../events/bus';
import { authorize } from '../permissions/authorize';
import { consumeRateLimit } from '../rate-limit/rate-limit';
import {
  CHECK_IN_ATTEMPT_LIMIT,
  CHECK_IN_ATTEMPT_WINDOW_SECONDS,
  CHECK_IN_CODE_GROUP,
  CHECK_IN_CODE_LENGTH,
} from './constants';
import { requireActiveMember } from './guards';
import {
  assertEventStatus,
  type EventRecord,
  findRsvp,
  loadEvent,
  OPEN_EVENT_STATUSES,
} from './records';
import { checkInSchema, eventIdSchema } from './schemas';
import { type CheckInWindow, checkInTiming, checkInWindow } from './timing';

/** Uppercase, separators and whitespace removed: "abcd-efgh" → "ABCDEFGH". */
export function normalizeCheckInCode(code: string): string {
  return code.toUpperCase().replace(/[\s_-]/g, '');
}

/** Bound to the event, so the same code never validates for another event. */
export function hashCheckInCode(eventId: string, code: string): string {
  return sha256Hex(`${eventId}:${normalizeCheckInCode(code)}`);
}

function displayCode(code: string): string {
  return `${code.slice(0, CHECK_IN_CODE_GROUP)}-${code.slice(CHECK_IN_CODE_GROUP)}`;
}

export interface IssuedCheckInCode {
  eventId: string;
  /** Shown exactly once; only its SHA-256 is stored. */
  code: string;
  issuedAt: Date;
  window: CheckInWindow;
}

/**
 * Issue (or rotate) the event's check-in code. The plaintext is returned
 * once and never stored or audited; a new code invalidates the previous one.
 */
export async function generateCheckInCode(
  ctx: ServiceContext,
  input: z.input<typeof eventIdSchema>,
): Promise<IssuedCheckInCode> {
  const data = parseInput(eventIdSchema, input);
  await authorize(ctx, 'canManageEvents', { type: 'event', id: data.eventId });
  return withTransaction(ctx, async (tx) => {
    const event = await loadEvent(tx, data.eventId, { lock: true });
    assertEventStatus(event, OPEN_EVENT_STATUSES, 'This event has already ended.');
    const now = tx.clock.now();
    if (now.getTime() > event.endsAt.getTime()) {
      throw new InvalidStateError('This event is already over.');
    }
    const code = randomCode(CHECK_IN_CODE_LENGTH);
    await tx.db
      .update(events)
      .set({
        checkInCodeHash: hashCheckInCode(event.id, code),
        checkInCodeIssuedAt: now,
        updatedAt: now,
      })
      .where(eq(events.id, event.id));
    await recordAudit(tx, {
      action: 'event.check_in_code_issued',
      targetType: 'event',
      targetId: event.id,
      context: { rotated: event.checkInCodeHash !== null },
    });
    return {
      eventId: event.id,
      code: displayCode(code),
      issuedAt: now,
      window: checkInWindow(event),
    };
  });
}

export interface CheckInResult {
  eventId: string;
  checkedInAt: Date;
  alreadyCheckedIn: boolean;
}

function assertCheckInOpen(event: EventRecord, now: Date): void {
  if (!OPEN_EVENT_STATUSES.includes(event.status)) {
    throw new InvalidStateError('Check-in is closed for this event.', { status: event.status });
  }
  const timing = checkInTiming(event, now);
  if (timing === 'early') {
    throw new InvalidStateError('Check-in opens 30 minutes before the start.');
  }
  if (timing === 'closed') throw new InvalidStateError('Check-in has closed.');
  if (!event.checkInCodeHash) {
    throw new InvalidStateError('Check-in is not open yet — the host has not issued a code.');
  }
}

/**
 * Check in with the code the host shares on site or on stream. Idempotent.
 * Attendance overrides the RSVP: a waitlisted, undecided or declined member
 * who is present becomes 'going'. Attempts are rate limited per member and
 * event; failures are audited.
 */
export async function checkIn(
  ctx: ServiceContext,
  input: z.input<typeof checkInSchema>,
): Promise<CheckInResult> {
  const data = parseInput(checkInSchema, input);
  const actor = requireActiveMember(ctx);
  const event = await loadEvent(ctx, data.eventId);
  const now = ctx.clock.now();
  assertCheckInOpen(event, now);

  const existing = await findRsvp(ctx, event.id, actor.memberId);
  if (existing?.checkedInAt) {
    return { eventId: event.id, checkedInAt: existing.checkedInAt, alreadyCheckedIn: true };
  }

  await consumeRateLimit(
    ctx,
    `event-check-in:${event.id}:${actor.memberId}`,
    CHECK_IN_ATTEMPT_LIMIT,
    CHECK_IN_ATTEMPT_WINDOW_SECONDS,
  );
  if (!safeEqual(hashCheckInCode(event.id, data.code), event.checkInCodeHash!)) {
    await recordAudit(
      ctx,
      {
        action: 'event.check_in_failed',
        targetType: 'event',
        targetId: event.id,
        result: 'denied',
        context: { reason: 'wrong_code' },
      },
      { durable: true },
    );
    throw new ValidationError('That check-in code is not valid.', [
      { path: 'code', message: 'invalid code' },
    ]);
  }

  return withTransaction(ctx, async (tx) => {
    // Re-check under the lock: the event may have been cancelled or the code rotated meanwhile.
    const locked = await loadEvent(tx, event.id, { lock: true });
    assertCheckInOpen(locked, now);
    if (locked.checkInCodeHash !== event.checkInCodeHash) {
      throw new InvalidStateError('The check-in code changed — ask the host for the new one.');
    }
    const [row] = await tx.db
      .insert(eventRsvps)
      .values({
        eventId: event.id,
        memberId: actor.memberId,
        status: 'going',
        respondedAt: now,
        checkedInAt: now,
      })
      .onConflictDoUpdate({
        target: [eventRsvps.eventId, eventRsvps.memberId],
        set: { status: 'going', checkedInAt: now },
        setWhere: isNull(eventRsvps.checkedInAt),
      })
      .returning();
    if (!row) {
      const current = await findRsvp(tx, event.id, actor.memberId);
      return { eventId: event.id, checkedInAt: current!.checkedInAt!, alreadyCheckedIn: true };
    }
    await publishEvent(tx, {
      type: 'event.checked_in',
      aggregateType: 'event',
      aggregateId: event.id,
      subjectMemberId: actor.memberId,
      payload: { kind: locked.kind, previousStatus: existing?.status ?? null },
    });
    return { eventId: event.id, checkedInAt: now, alreadyCheckedIn: false };
  });
}
