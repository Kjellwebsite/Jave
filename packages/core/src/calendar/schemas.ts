import { z } from 'zod';
import { eventKind, rsvpStatus } from '@jave/database';
import { pageSchema } from '../kernel/pagination';
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  CHECK_IN_CODE_INPUT_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_LOCATION_MAX,
  EVENT_TITLE_MAX,
  EVENT_TITLE_MIN,
  MAX_EVENT_CAPACITY,
  MAX_MATCH_SCORE,
  MAX_TEAM_SIZE,
  TEAM_NAME_MAX,
  TEAM_SEED_MAX,
} from './constants';
import { classifyLocation } from './location';

const CONTROL_CHARACTER = /\p{Cc}/u;
const ALLOWED_MULTILINE_CONTROLS = /[\n\t]/g;

/** One line of plain text: trimmed, no control characters. */
export const singleLine = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !CONTROL_CHARACTER.test(value), 'must be a single line of plain text');

/** Multi-line plain text: newlines and tabs allowed, other control characters rejected. */
export const multiLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value.replace(/\r\n?/g, '\n'))
    .refine(
      (value) => !CONTROL_CHARACTER.test(value.replace(ALLOWED_MULTILINE_CONTROLS, '')),
      'contains unsupported control characters',
    );

/** A Date or an ISO-8601 timestamp with an explicit offset. */
export const dateInput = z
  .union([z.date(), z.iso.datetime({ offset: true })])
  .transform((value) => new Date(value))
  .refine((value) => !Number.isNaN(value.getTime()), 'must be a valid date');

export const locationInput = z
  .string()
  .trim()
  .min(1)
  .max(EVENT_LOCATION_MAX)
  .refine((value) => !CONTROL_CHARACTER.test(value), 'must be a single line of plain text')
  .refine(
    (value) => classifyLocation(value) !== null,
    'must be a Discord channel id, an http(s) URL, or a place name',
  );

const eventKindInput = z.enum(eventKind.enumValues);
const titleInput = singleLine(EVENT_TITLE_MIN, EVENT_TITLE_MAX);
const descriptionInput = multiLine(EVENT_DESCRIPTION_MAX);
const capacityInput = z.number().int().min(1).max(MAX_EVENT_CAPACITY);

export const scheduleEventSchema = z.object({
  title: titleInput,
  description: descriptionInput.optional(),
  kind: eventKindInput,
  startsAt: dateInput,
  /** Defaults to startsAt + 2 h. */
  endsAt: dateInput.optional(),
  location: locationInput.optional(),
  capacity: capacityInput.optional(),
  rsvpClosesAt: dateInput.optional(),
  /** Defaults to the scheduling member. */
  hostMemberId: z.uuid().optional(),
});

export const updateEventSchema = z
  .object({
    eventId: z.uuid(),
    title: titleInput.optional(),
    description: descriptionInput.nullable().optional(),
    kind: eventKindInput.optional(),
    startsAt: dateInput.optional(),
    endsAt: dateInput.optional(),
    location: locationInput.nullable().optional(),
    capacity: capacityInput.nullable().optional(),
    rsvpClosesAt: dateInput.nullable().optional(),
    hostMemberId: z.uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'eventId'), 'nothing to update');

export const eventIdSchema = z.object({ eventId: z.uuid() });

export const cancelEventSchema = z.object({
  eventId: z.uuid(),
  reason: singleLine(CANCEL_REASON_MIN, CANCEL_REASON_MAX),
});

export const listEventsSchema = pageSchema.extend({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
  kind: eventKindInput.optional(),
});

export const rsvpSchema = z.object({
  eventId: z.uuid(),
  status: z.enum(['going', 'maybe', 'declined']),
});

export const participantsSchema = pageSchema.extend({
  eventId: z.uuid(),
  status: z.enum(rsvpStatus.enumValues).optional(),
});

export const memberHistorySchema = pageSchema.extend({ memberId: z.uuid() });

export const checkInSchema = z.object({
  eventId: z.uuid(),
  code: z.string().trim().min(1).max(CHECK_IN_CODE_INPUT_MAX),
});

// ─── Discord callbacks ───────────────────────────────────────────────────────

const snowflakeInput = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

/** The id the publication showed for the slot when the bot created: null for a first create. */
const replacesInput = snowflakeInput.nullable();

export const markEventPublishedSchema = z
  .object({
    eventId: z.uuid(),
    /** events.revision of the publication the bot rendered the created objects from. */
    revision: z.number().int().min(0),
    scheduledEvent: z.object({ id: snowflakeInput, replaces: replacesInput }).strict().optional(),
    announcement: z
      .object({ channelId: snowflakeInput, messageId: snowflakeInput, replaces: replacesInput })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.scheduledEvent !== undefined || value.announcement !== undefined,
    'nothing to report',
  );

// ─── Teams & tournaments ─────────────────────────────────────────────────────

const teamNameInput = singleLine(1, TEAM_NAME_MAX);

export const createTeamSchema = z.object({
  eventId: z.uuid(),
  name: teamNameInput,
  memberIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_TEAM_SIZE)
    .refine((ids) => new Set(ids).size === ids.length, 'members must be unique'),
  /** Bracket seed (1 = strongest). Optional; unseeded teams follow seeded ones. */
  seed: z.number().int().min(1).max(32_000).optional(),
});

export const randomTeamsSchema = z.object({
  eventId: z.uuid(),
  teamSize: z.number().int().min(1).max(MAX_TEAM_SIZE),
  /** Deterministic draw: the same seed and RSVPs give the same teams. Defaults to the event id. */
  seed: singleLine(1, TEAM_SEED_MAX).optional(),
});

export const teamIdSchema = z.object({ teamId: z.uuid() });

export const generateBracketSchema = z.object({
  eventId: z.uuid(),
  /** 'seeded' orders by team seed (then name); 'random' draws with `seed`. */
  seeding: z.enum(['seeded', 'random']).default('seeded'),
  seed: singleLine(1, TEAM_SEED_MAX).optional(),
});

const scoreInput = z.number().int().min(0).max(MAX_MATCH_SCORE);

export const reportMatchSchema = z
  .object({
    matchId: z.uuid(),
    scoreA: scoreInput.optional(),
    scoreB: scoreInput.optional(),
    /** Required for a forfeit (no scores) or to break a tied score. */
    winner: z.enum(['a', 'b']).optional(),
  })
  .refine(
    (value) => (value.scoreA === undefined) === (value.scoreB === undefined),
    'give both scores or neither',
  );
