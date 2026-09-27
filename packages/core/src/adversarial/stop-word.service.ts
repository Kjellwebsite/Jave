import { and, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { adversarialRoles, members, trialTeams, users } from '@jave/database';
import type { ServiceContext } from '../kernel/context';
import { parseInput } from '../kernel/validation';
import { can } from '../permissions/authorize';
import { findUserByDiscordId, resolveUserActor } from '../identity/users.service';
import { actorParticipatesIn, assertSystemActor, loadTrial } from './guards';
import { alertStaff } from './notify';
import { stopForRedFlag } from './red-flag.service';
import { STOP_WORD } from './safety';
import { stopWordTypedSchema } from './schemas';
import { OPERATIVE_STOPPABLE_STATUSES, type RoleRecord } from './state';

/** Who typed the stop word, relative to one running exercise. */
export type StopWordTypist = 'operative' | 'staff' | 'participant';

export interface StopWordOutcome {
  roleId: string;
  typedBy: StopWordTypist;
  /** This message stopped the exercise (never for a participant's mention). */
  stopped: boolean;
}

/** Recorded with the RED FLAG on the role row (staff-only); never shown to participants. */
export const STOP_WORD_CHAT_NOTE = 'Stop word typed in Discord.';

/** Dedupe fact: managers hear about participants' mentions once per exercise. */
const MENTION_FACT = 'stop-word-mention';

interface RunningRole {
  role: RoleRecord;
  operativeDiscordId: string;
  teamChannelId: string | null;
}

/**
 * Roles the message concerns: the author's own briefed or active roles
 * (anywhere in the server), and the briefed or active role of the team whose
 * channel the message is in.
 */
async function concernedRoles(
  ctx: ServiceContext,
  discordUserId: string,
  channelId: string | null,
): Promise<RunningRole[]> {
  const concerns: SQL[] = [eq(users.discordId, discordUserId)];
  if (channelId) concerns.push(eq(trialTeams.discordChannelId, channelId));
  return ctx.db
    .select({
      role: adversarialRoles,
      operativeDiscordId: users.discordId,
      teamChannelId: trialTeams.discordChannelId,
    })
    .from(adversarialRoles)
    .innerJoin(members, eq(members.id, adversarialRoles.operativeMemberId))
    .innerJoin(users, eq(users.id, members.userId))
    .leftJoin(trialTeams, eq(trialTeams.id, adversarialRoles.teamId))
    .where(
      and(inArray(adversarialRoles.status, [...OPERATIVE_STOPPABLE_STATUSES]), or(...concerns)),
    );
}

/**
 * Participants are never told the stop word, so their use of it is not a
 * call to stop: managers are alerted (once per exercise) to check in with the
 * operative, who is bound to stop when anyone says it. Deliberately not
 * audited: an audit row written the moment a participant typed the words
 * would tell a staff member competing in the trial (the audit log is readable
 * with canViewAuditLogs) that their team hosts a role.
 */
async function alertMention(ctx: ServiceContext, role: RoleRecord): Promise<void> {
  const trial = await loadTrial(ctx, role.trialId);
  await alertStaff(ctx, {
    roleId: role.id,
    trialId: role.trialId,
    fact: MENTION_FACT,
    title: `STOP WORD IN CHAT — TRIAL #${trial.number}`,
    body: `Someone other than the operative typed ${STOP_WORD} in the team channel. The exercise is still running: participants are never told the stop word, so it may be ordinary vocabulary. Check in with the operative, then stop the exercise or let it run. Later mentions in this exercise are not re-sent.`,
  });
}

/**
 * The stop word seen in a Discord message (bot message listener; system
 * actor only). Who typed it decides what happens:
 *
 * - the operative, anywhere in the server → RED FLAG for their briefed or
 *   active roles, recorded as raised by the operative;
 * - adversarial staff (canManageAdversarial, not taking part in the trial),
 *   in the team channel → RED FLAG, recorded as raised by that staff member;
 * - anyone else in the team channel of an active exercise → no stop; managers
 *   are alerted once (see `alertMention`).
 *
 * Nothing here is visible to participants. Never throws for a RED FLAG race.
 */
export async function stopWordTyped(
  ctx: ServiceContext,
  input: z.input<typeof stopWordTypedSchema>,
): Promise<StopWordOutcome[]> {
  assertSystemActor(ctx);
  const data = parseInput(stopWordTypedSchema, input);
  const concerned = await concernedRoles(ctx, data.discordUserId, data.channelId);
  if (concerned.length === 0) return [];
  const author = await findUserByDiscordId(ctx, data.discordUserId);
  const asAuthor: ServiceContext | null = author
    ? { ...ctx, actor: await resolveUserActor(ctx, author.id) }
    : null;

  const outcomes: StopWordOutcome[] = [];
  for (const { role, operativeDiscordId, teamChannelId } of concerned) {
    if (asAuthor && operativeDiscordId === data.discordUserId) {
      const result = await stopForRedFlag(asAuthor, role, {
        raisedBy: 'the operative',
        via: 'chat',
        note: STOP_WORD_CHAT_NOTE,
      });
      outcomes.push({ roleId: role.id, typedBy: 'operative', stopped: !result.alreadyStopped });
      continue;
    }
    // Not the operative: only the team channel concerns this role.
    if (!data.channelId || teamChannelId !== data.channelId) continue;
    const isStaff =
      asAuthor !== null &&
      can(asAuthor, 'canManageAdversarial') &&
      !(await actorParticipatesIn(asAuthor, role.trialId));
    if (isStaff) {
      const result = await stopForRedFlag(asAuthor, role, {
        raisedBy: 'staff',
        via: 'chat',
        note: STOP_WORD_CHAT_NOTE,
      });
      outcomes.push({ roleId: role.id, typedBy: 'staff', stopped: !result.alreadyStopped });
      continue;
    }
    if (role.status === 'active') await alertMention(ctx, role);
    outcomes.push({ roleId: role.id, typedBy: 'participant', stopped: false });
  }
  return outcomes;
}
