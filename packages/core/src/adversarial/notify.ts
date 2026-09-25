import type { ServiceContext } from '../kernel/context';
import { truncate } from '../kernel/redact';
import { notify, notifyCapabilityHolders } from '../notifications/notifications.service';
import { STOP_NOTICE } from './briefing';
import { memberUserId, teamParticipantUserIds, trialParticipantUserIds } from './guards';
import { STOP_WORD } from './safety';
import { type RoleRecord, type Technique, TECHNIQUE_LABELS } from './state';

/**
 * Notification copy and fan-out for the adversarial module. Every notification
 * carries a dedupe key on the underlying fact. Staff copy never names the
 * operative; participant copy exists only after the reveal.
 */

const MAX_DEBRIEF_IN_NOTIFICATION = 1500;

type OperativeMessage =
  'briefed' | 'briefing_updated' | 'active' | 'concluded' | 'stop' | 'revealed';

function operativeCopy(kind: OperativeMessage, trialNumber: number, revision: number) {
  const trial = `Trial #${trialNumber}`;
  switch (kind) {
    case 'briefed':
      return {
        type: 'adversarial.briefing' as const,
        title: 'CONFIDENTIAL BRIEFING',
        body: `You were selected for an authorized exercise in ${trial}. Your briefing arrives by DM and is on your dashboard. Keep it confidential.`,
        // The full briefing is DMed by discord.adversarial.brief; the inbox row is a pointer.
        channels: [] as const,
      };
    case 'briefing_updated':
      return {
        type: 'adversarial.briefing' as const,
        title: 'BRIEFING UPDATED',
        body: `${trial}: your briefing changed (revision ${revision}). The new version arrives by DM.`,
        channels: [] as const,
      };
    case 'active':
      return {
        type: 'adversarial.briefing' as const,
        title: 'EXERCISE LIVE',
        body: `${trial}: proceed per your briefing. Guardrails apply. Stop word: ${STOP_WORD}.`,
      };
    case 'concluded':
      return {
        type: 'adversarial.briefing' as const,
        title: 'EXERCISE CONCLUDED',
        body: `${trial}: stand down. Keep your role confidential until the official reveal.`,
      };
    case 'stop':
      return {
        type: 'adversarial.stop' as const,
        title: STOP_NOTICE.title,
        body: `${trial}: ${STOP_NOTICE.body}`,
      };
    case 'revealed':
      return {
        type: 'adversarial.briefing' as const,
        title: 'ROLE REVEALED',
        body: `${trial}: your role was disclosed to your team with the debrief. Thank you for operating within the guardrails.`,
      };
  }
}

export async function notifyOperative(
  ctx: ServiceContext,
  role: Pick<RoleRecord, 'id' | 'operativeMemberId' | 'briefingRevision'>,
  kind: OperativeMessage,
  trialNumber: number,
): Promise<void> {
  const userId = await memberUserId(ctx, role.operativeMemberId);
  if (!userId) return;
  const copy = operativeCopy(kind, trialNumber, role.briefingRevision);
  const suffix = kind === 'briefing_updated' ? `:${role.briefingRevision}` : '';
  await notify(ctx, {
    recipientUserId: userId,
    type: copy.type,
    title: copy.title,
    body: copy.body,
    data: { roleId: role.id },
    dedupeKey: `adversarial:${role.id}:${kind}${suffix}`,
    ...('channels' in copy ? { channels: copy.channels } : {}),
  });
}

/**
 * Staff recipients never include anyone taking part in the trial: a staff
 * member competing in a trial must not learn it hosts an adversarial role.
 */
async function staffExclusions(
  ctx: ServiceContext,
  trialId: string,
  extra: readonly string[] = [],
): Promise<string[]> {
  return [...new Set([...extra, ...(await trialParticipantUserIds(ctx, trialId))])];
}

/** Ask every other authorizer for the second signature. */
export async function requestAuthorization(
  ctx: ServiceContext,
  input: {
    roleId: string;
    trialId: string;
    trialNumber: number;
    teamName: string;
    excludeUserIds: string[];
  },
): Promise<void> {
  await notifyCapabilityHolders(
    ctx,
    'canAuthorizeAdversarial',
    {
      type: 'adversarial.staff',
      title: 'AUTHORIZATION REQUESTED',
      body: `An adversarial role for Trial #${input.trialNumber} (${input.teamName}) awaits a second authorizer.`,
      data: { roleId: input.roleId },
      dedupeKey: `adversarial:${input.roleId}:authorization`,
    },
    { excludeUserIds: await staffExclusions(ctx, input.trialId, input.excludeUserIds) },
  );
}

/** A single staff member (planner) — skipped if they take part in the trial. */
export async function notifyStaffUser(
  ctx: ServiceContext,
  input: {
    userId: string | null;
    roleId: string;
    trialId: string;
    fact: string;
    title: string;
    body: string;
  },
): Promise<void> {
  if (!input.userId) return;
  if ((await trialParticipantUserIds(ctx, input.trialId)).includes(input.userId)) return;
  await notify(ctx, {
    recipientUserId: input.userId,
    type: 'adversarial.staff',
    title: input.title,
    body: input.body,
    data: { roleId: input.roleId },
    dedupeKey: `adversarial:${input.roleId}:${input.fact}`,
  });
}

/** Critical alert to everyone who manages adversarial roles. */
export async function alertStaff(
  ctx: ServiceContext,
  input: {
    roleId: string;
    trialId: string;
    fact: string;
    title: string;
    body: string;
    excludeUserIds?: string[];
  },
): Promise<void> {
  await notifyCapabilityHolders(
    ctx,
    'canManageAdversarial',
    {
      type: 'adversarial.alert',
      title: input.title,
      body: input.body,
      data: { roleId: input.roleId },
      dedupeKey: `adversarial:${input.roleId}:${input.fact}`,
    },
    { excludeUserIds: await staffExclusions(ctx, input.trialId, input.excludeUserIds) },
  );
}

/** Reminder to every manager that a reveal is owed. */
export async function remindReveal(
  ctx: ServiceContext,
  input: { roleId: string; trialId: string; trialNumber: number },
): Promise<void> {
  await notifyCapabilityHolders(
    ctx,
    'canManageAdversarial',
    {
      type: 'adversarial.staff',
      title: `REVEAL PENDING — TRIAL #${input.trialNumber}`,
      body: 'An adversarial exercise awaits evaluation and reveal. Participants are owed a debrief.',
      data: { roleId: input.roleId },
      dedupeKey: `adversarial:${input.roleId}:reveal-reminder`,
    },
    { excludeUserIds: await staffExclusions(ctx, input.trialId) },
  );
}

/** After the reveal: every participant on the team learns about the exercise and gets the debrief. */
export async function notifyTeamOfReveal(
  ctx: ServiceContext,
  input: {
    role: Pick<RoleRecord, 'id' | 'trialId' | 'teamId' | 'operativeMemberId'>;
    trialNumber: number;
    technique: Technique;
    debrief: string;
  },
): Promise<number> {
  const { role } = input;
  if (!role.teamId) return 0;
  const participants = await teamParticipantUserIds(ctx, {
    trialId: role.trialId,
    teamId: role.teamId,
  });
  let sent = 0;
  for (const participant of participants) {
    if (participant.memberId === role.operativeMemberId) continue;
    const id = await notify(ctx, {
      recipientUserId: participant.userId,
      type: 'adversarial.revealed',
      title: `EXERCISE REVEALED — TRIAL #${input.trialNumber}`,
      body: `Your team took part in an authorized security-culture exercise (${TECHNIQUE_LABELS[input.technique]}). Fictional data only.\n\n${truncate(input.debrief, MAX_DEBRIEF_IN_NOTIFICATION)}`,
      data: { roleId: role.id },
      dedupeKey: `adversarial:${role.id}:revealed:${participant.userId}`,
    });
    if (id) sent++;
  }
  return sent;
}
