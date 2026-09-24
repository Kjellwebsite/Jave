import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { calendarJobHandlers, calendarRecurringJobs } from './jobs';

// Module: calendar — JAVELIN events, RSVPs, check-in, reminders, teams and
// single-elimination tournaments. Named 'calendar' because 'events' is the
// domain-event bus.

export * from './constants';
export {
  scheduleEvent,
  updateEvent,
  cancelEvent,
  markEventLive,
  completeEvent,
  getEvent,
  listEvents,
  type CompletionSource,
} from './events.service';
export {
  rsvp,
  listParticipants,
  listMemberEventHistory,
  type RsvpResult,
  type ParticipantView,
  type EventHistoryItem,
} from './rsvp.service';
export {
  generateCheckInCode,
  checkIn,
  normalizeCheckInCode,
  type IssuedCheckInCode,
  type CheckInResult,
} from './check-in.service';
export {
  createTeam,
  createRandomTeams,
  deleteTeam,
  listTeams,
  type TeamView,
  type TeamMemberView,
} from './teams.service';
export {
  generateBracket,
  reportMatch,
  getBracket,
  type BracketView,
  type MatchView,
  type BracketTeamView,
} from './tournament.service';
export {
  DISCORD_EVENTS_PUBLISH_JOB,
  DISCORD_EVENTS_CANCEL_JOB,
  discordEventsPublishPayloadSchema,
  discordEventsCancelPayloadSchema,
  getEventPublication,
  markEventPublished,
  type DiscordEventsPublishPayload,
  type DiscordEventsCancelPayload,
  type EventPublication,
} from './discord-jobs';
export {
  buildSingleElimination,
  seedOrder,
  nextPowerOfTwo,
  roundName,
  decideWinner,
  type BracketPlan,
  type PlannedMatch,
} from './bracket';
export { drawTeams } from './team-draw';
export { checkInWindow, isRsvpOpen, type CheckInWindow } from './timing';
export { classifyLocation, type LocationKind, type LocationView } from './location';
export type { EventView, MyRsvpView } from './views';
export type { EventKind, EventStatus, RsvpStatus, RsvpCounts } from './records';
export * as schemas from './schemas';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = calendarJobHandlers;
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = calendarRecurringJobs;
