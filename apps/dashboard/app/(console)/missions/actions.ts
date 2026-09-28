'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isUuid, missions, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formBoolean, formOptional, formString, formStrings } from '@/lib/form-data';
import type { MemberSearchResult } from '@/lib/member-search';
import {
  editedDeadline,
  MISSION_FORM_FIELDS,
  missionFormInput,
  optionalNumber,
} from '@/lib/mission-form';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';
import { runMemberSearch } from '@/server/data/member-search';
import { loadViewer } from '@/server/data/viewer';

const SKIP_LABELS: Record<missions.AssignSkipReason, string> = {
  not_found: 'no profile',
  ineligible: 'standing',
  already_assigned: 'already on it',
  completed: 'already verified',
  team_locked: 'on another team',
  mission_full: 'no slot left',
};

function uuidField(data: FormData, name: string, label: string): string {
  const value = formString(data, name);
  if (!isUuid(value)) throw new ValidationError(`Unknown ${label}.`);
  return value;
}

function missionIdFrom(data: FormData): string {
  return uuidField(data, 'missionId', 'mission');
}

function refresh(missionId?: string): void {
  revalidatePath('/missions');
  if (missionId) revalidatePath(`/missions/${missionId}`);
}

function headline(mission: Pick<missions.MissionRecord, 'number' | 'title'>): string {
  return `${missions.formatMissionNumber(mission.number)} — ${mission.title}`;
}

// ── Staff: definition and lifecycle ─────────────────────────────────────────

export async function createMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  let createdId: string | null = null;
  const state = await runAction(
    'missions.create',
    async (ctx) => {
      const { timeZone } = await loadViewer(ctx);
      const { type, ...input } = missionFormInput(data, timeZone);
      if (!type)
        throw new ValidationError('Choose a mission type.', [
          { path: 'type', message: 'Choose a mission type.' },
        ]);
      const created = await missions.createMission(ctx, { ...input, type });
      createdId = created.id;
      refresh();
      return `DRAFT CREATED — ${headline(created)}.`;
    },
    { fieldNames: MISSION_FORM_FIELDS },
  );
  if (createdId) redirect(`/missions/${createdId}?saved=created`);
  return state;
}

export async function updateMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  let updatedId: string | null = null;
  const state = await runAction(
    'missions.update',
    async (ctx) => {
      const missionId = missionIdFrom(data);
      const [{ timeZone }, { mission }] = await Promise.all([
        loadViewer(ctx),
        missions.getMissionDetail(ctx, { missionId }),
      ]);
      const { type, ...fields } = missionFormInput(data, timeZone);
      // The form sends every field back: a deadline left as shown stays exactly as stored.
      const patch = { ...fields, deadlineAt: editedDeadline(data, mission.deadlineAt, timeZone) };
      const updated = await missions.updateMission(ctx, {
        missionId,
        patch: type ? { ...patch, type } : patch,
      });
      updatedId = updated.id;
      refresh(missionId);
      return `MISSION UPDATED — ${headline(updated)}.`;
    },
    { fieldNames: MISSION_FORM_FIELDS },
  );
  if (updatedId) redirect(`/missions/${updatedId}?saved=updated`);
  return state;
}

export async function publishMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('missions.publish', async (ctx) => {
    const missionId = missionIdFrom(data);
    const announce = formBoolean(data, 'announce');
    const { mission, announced } = await missions.publishMission(ctx, { missionId, announce });
    refresh(missionId);
    const card = announced
      ? ' The card is posting to Discord.'
      : announce
        ? ' No missions channel is configured, so no card was posted.'
        : '';
    return `MISSION PUBLISHED — ${headline(mission)}.${card}`;
  });
}

type Transition = 'close' | 'reopen' | 'archive';

async function transition(ctx: UserContext, kind: Transition, missionId: string) {
  switch (kind) {
    case 'close':
      return missions.closeMission(ctx, { missionId });
    case 'reopen':
      return missions.reopenMission(ctx, { missionId });
    case 'archive':
      return missions.archiveMission(ctx, { missionId });
  }
}

const TRANSITION_COPY: Record<Transition, string> = {
  close: 'MISSION CLOSED',
  reopen: 'MISSION REOPENED',
  archive: 'MISSION ARCHIVED',
};

function transitionAction(kind: Transition) {
  return async (data: FormData): Promise<ActionState> =>
    runAction(`missions.${kind}`, async (ctx) => {
      const missionId = missionIdFrom(data);
      const mission = await transition(ctx, kind, missionId);
      refresh(missionId);
      return `${TRANSITION_COPY[kind]} — ${headline(mission)}.`;
    });
}

const close = transitionAction('close');
const reopen = transitionAction('reopen');
const archive = transitionAction('archive');

export async function closeMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return close(data);
}

export async function reopenMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return reopen(data);
}

export async function archiveMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return archive(data);
}

// ── Staff: roster and review ────────────────────────────────────────────────

/** The assign dialog's member search: mission managers only. */
export async function searchAssignableMembersAction(query: string): Promise<MemberSearchResult> {
  return runMemberSearch('canManageMissions', query);
}

export async function assignMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'missions.assign',
    async (ctx) => {
      const missionId = missionIdFrom(data);
      const memberIds = [...new Set(formStrings(data, 'memberId'))];
      if (memberIds.length === 0)
        throw new ValidationError('Choose at least one member.', [
          { path: 'memberIds', message: 'Choose at least one member.' },
        ]);
      const durationHours = optionalNumber(data, 'durationHours');
      const result = await missions.assignMission(ctx, {
        missionId,
        memberIds,
        teamKey: formOptional(data, 'teamKey'),
        durationHours: durationHours ?? undefined,
      });
      refresh(missionId);
      const skipped = result.skipped.length
        ? ` Skipped ${result.skipped.length}: ${[...new Set(result.skipped.map((s) => SKIP_LABELS[s.reason]))].join(', ')}.`
        : '';
      return `${result.assigned.length} ASSIGNED — members are notified and accept before they start.${skipped}`;
    },
    { fieldNames: ['memberIds', 'teamKey', 'durationHours'] },
  );
}

export async function verifySubmissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'missions.verify',
    async (ctx) => {
      const assignmentId = uuidField(data, 'assignmentId', 'submission');
      const verified = await missions.verifySubmission(ctx, {
        assignmentId,
        feedback: formOptional(data, 'feedback'),
      });
      refresh(verified[0]?.missionId);
      return `SUBMISSION VERIFIED — recorded as evidence for ${verified.length} member${verified.length === 1 ? '' : 's'}.`;
    },
    { fieldNames: ['feedback'] },
  );
}

export async function rejectSubmissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'missions.reject',
    async (ctx) => {
      const assignmentId = uuidField(data, 'assignmentId', 'submission');
      const rejected = await missions.rejectSubmission(ctx, {
        assignmentId,
        feedback: formString(data, 'feedback'),
      });
      refresh(rejected[0]?.missionId);
      return `SUBMISSION RETURNED — ${rejected.length} member${rejected.length === 1 ? '' : 's'} notified with your feedback.`;
    },
    { fieldNames: ['feedback'] },
  );
}

// ── Members: their own assignment ───────────────────────────────────────────

async function ownAssignment(ctx: UserContext, missionId: string) {
  const detail = await missions.getMissionDetail(ctx, { missionId });
  if (!detail.myAssignment) throw new ValidationError('You hold no assignment on this mission.');
  return { detail, own: detail.myAssignment };
}

export async function acceptMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('missions.accept', async (ctx) => {
    const missionId = missionIdFrom(data);
    const detail = await missions.getMissionDetail(ctx, { missionId });
    const own = detail.myAssignment;
    if (own?.status === 'assigned') await missions.acceptMission(ctx, { assignmentId: own.id });
    else await missions.selfAssignMission(ctx, { missionId });
    refresh(missionId);
    return `MISSION ACCEPTED — ${detail.mission.number} — ${detail.mission.title}.`;
  });
}

export async function submitMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'missions.submit',
    async (ctx) => {
      const missionId = missionIdFrom(data);
      const { own } = await ownAssignment(ctx, missionId);
      const evidenceTitle = formOptional(data, 'evidenceTitle');
      const evidenceUrl = formOptional(data, 'evidenceUrl');
      if (Boolean(evidenceTitle) !== Boolean(evidenceUrl))
        throw new ValidationError('Give the evidence a title and a link, or neither.', [
          {
            path: evidenceTitle ? 'evidence.url' : 'evidence.title',
            message: 'Needed with the other evidence field.',
          },
        ]);
      const submitted = await missions.submitMission(ctx, {
        assignmentId: own.id,
        submission: formString(data, 'submission'),
        evidence:
          evidenceTitle && evidenceUrl ? { title: evidenceTitle, url: evidenceUrl } : undefined,
      });
      refresh(missionId);
      const team = submitted.teamKey ? ' Your team moves to review with you.' : '';
      return `SUBMISSION SENT — attempt ${submitted.attempts} of ${missions.MAX_SUBMISSION_ATTEMPTS}.${team}`;
    },
    { fieldNames: ['submission', 'evidence.title', 'evidence.url', 'evidence'] },
  );
}

export async function abandonMissionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('missions.abandon', async (ctx) => {
    const missionId = missionIdFrom(data);
    const { detail, own } = await ownAssignment(ctx, missionId);
    await missions.abandonMission(ctx, { assignmentId: own.id });
    refresh(missionId);
    return `MISSION ABANDONED — ${detail.mission.number}. Staff can reassign you if needed.`;
  });
}
