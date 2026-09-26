import {
  findMemberByDiscordId,
  isUuid,
  loadCatalog,
  missions,
  NotFoundError,
  ValidationError,
} from '@jave/core';
import type { HandlerContext } from '../../interactions/types';

/** A mission picked in a slash command option (autocomplete values are mission ids). */
export function missionFromOption(h: HandlerContext, name = 'mission'): string {
  const value = h.interaction.options.string(name)?.trim();
  if (!value) throw new ValidationError('Pick a mission.');
  if (!isUuid(value)) throw new ValidationError('Pick a mission from the list.');
  return value;
}

/** A mission id from a custom id. Untrusted: anything malformed reads as not found. */
export function missionFromArg(value: string | undefined): string {
  if (!value || !isUuid(value)) throw new NotFoundError('Mission');
  return value;
}

/** A mission type from a select or option value; anything else means "all types". */
export function typeFromValue(value: string | null | undefined): missions.MissionType | null {
  return (missions.MISSION_TYPES as readonly string[]).includes(value ?? '')
    ? (value as missions.MissionType)
    : null;
}

/** Non-negative page offset from a custom-id argument. */
export function offsetFromArg(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function facetLabelOf(
  h: HandlerContext,
  facetKey: string | null,
): Promise<string | null> {
  if (!facetKey) return null;
  const catalog = await loadCatalog(h.ctx);
  return catalog.facets.find((facet) => facet.key === facetKey)?.label ?? null;
}

/** The viewer's own assignment on a mission. Someone else's never resolves (no IDOR). */
export async function ownAssignment(
  h: HandlerContext,
  missionId: string,
): Promise<{ detail: missions.MissionDetail; own: missions.OwnAssignmentView }> {
  const detail = await missions.getMissionDetail(h.ctx, { missionId });
  if (!detail.myAssignment) throw new NotFoundError('Assignment');
  return { detail, own: detail.myAssignment };
}

export interface ResolvedAssignees {
  memberIds: string[];
  /** Discord ids of picked users without a JVLN profile. */
  unknown: string[];
}

/** Map picked Discord users to members. Users JAVE does not know are reported, not guessed. */
export async function resolveAssignees(
  h: HandlerContext,
  discordIds: readonly string[],
): Promise<ResolvedAssignees> {
  const memberIds: string[] = [];
  const unknown: string[] = [];
  for (const discordId of new Set(discordIds)) {
    const member = await findMemberByDiscordId(h.ctx, discordId);
    if (member) memberIds.push(member.id);
    else unknown.push(discordId);
  }
  return { memberIds, unknown };
}

const NOT_GIVEN = '-';

/** Team key and hours travel inside the user select's custom id; '-' marks "not given". */
export function encodeAssignOptions(teamKey: string | null, hours: number | null): string[] {
  return [teamKey ?? NOT_GIVEN, hours === null ? NOT_GIVEN : String(hours)];
}

export function decodeAssignOptions(args: readonly string[]): {
  teamKey: string | null;
  durationHours: number | null;
} {
  const [team, hours] = args;
  const parsedHours = Number(hours);
  return {
    teamKey: team && team !== NOT_GIVEN ? team : null,
    durationHours: hours && hours !== NOT_GIVEN && Number.isInteger(parsedHours) ? parsedHours : null,
  };
}

/** Team key as typed by staff, normalized like core does, or null when blank. */
export function parseTeamKey(value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase() ?? '';
  if (key === '') return null;
  if (!missions.TEAM_KEY_PATTERN.test(key))
    throw new ValidationError('teamKey: Team key: 1–32 chars, a–z, 0–9, - or _');
  return key;
}

const HOURS_PATTERN = /^\d{1,4}$/;

/** Optional whole hours (per-assignment time limit), or null when blank. */
export function parseHours(value: string | null | undefined, field: string): number | null {
  const raw = value?.trim() ?? '';
  if (raw === '') return null;
  if (!HOURS_PATTERN.test(raw)) throw new ValidationError(`${field}: whole hours, e.g. 72`);
  const hours = Number(raw);
  if (hours < 1 || hours > missions.MAX_DURATION_HOURS)
    throw new ValidationError(`${field}: between 1 and ${missions.MAX_DURATION_HOURS} hours`);
  return hours;
}

const DEADLINE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/** "YYYY-MM-DD HH:MM" in UTC, or null when blank. Impossible dates are refused, not rolled over. */
export function parseDeadline(value: string | null | undefined): Date | null {
  const raw = value?.trim() ?? '';
  if (raw === '') return null;
  const match = DEADLINE_PATTERN.exec(raw);
  const invalid = new ValidationError('deadlineAt: use YYYY-MM-DD HH:MM (UTC)');
  if (!match) throw invalid;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  )
    throw invalid;
  return date;
}
