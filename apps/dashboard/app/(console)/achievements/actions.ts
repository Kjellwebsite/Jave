'use server';

import { revalidatePath } from 'next/cache';
import {
  achievements,
  authorize,
  can,
  getProfile,
  isJaveError,
  isUuid,
  newErrorId,
  ValidationError,
} from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { DEFINITION_FORM_FIELDS, definitionFields } from '@/lib/achievement-form';
import type { HeldAwardsResult } from '@/lib/achievement-labels';
import { formString } from '@/lib/form-data';
import type { MemberSearchResult } from '@/lib/member-search';
import { runAction } from '@/server/actions';
import { getRequestContext, isUserContext, type UserContext } from '@/server/context';
import { runMemberSearch } from '@/server/data/member-search';
import { isTrustedMutationRequest } from '@/server/request';

const PAGE = '/achievements';
const MEMBER_FIELDS = ['memberId', 'key', 'reason'] as const;

function refresh(memberId?: string): void {
  revalidatePath(PAGE);
  if (memberId) revalidatePath(`/members/${memberId}`);
}

/** "MENTOR" for copy; achievement staff see every definition unmasked (managers: inactive too). */
async function titleOf(ctx: UserContext, key: string): Promise<string> {
  const catalog = await achievements.getAchievementCatalog(ctx, {
    includeInactive: can(ctx, 'canManageAchievements'),
  });
  const entry = catalog.find((candidate) => !candidate.masked && candidate.key === key);
  return (entry && !entry.masked ? entry.title : key).toUpperCase();
}

/** The member picked in an award or revoke dialog. Profile visibility rules apply. */
async function pickedMember(ctx: UserContext, data: FormData) {
  const memberId = formString(data, 'memberId');
  if (!isUuid(memberId))
    throw new ValidationError('Choose a member.', [
      { path: 'memberId', message: 'Choose a member.' },
    ]);
  return getProfile(ctx, { memberId });
}

// ── Definitions (canManageAchievements) ─────────────────────────────────────

export async function createDefinitionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'achievements.create_definition',
    async (ctx) => {
      const created = await achievements.createAchievementDefinition(ctx, {
        key: formString(data, 'key').trim(),
        ...definitionFields(data),
      });
      refresh();
      return `ACHIEVEMENT DEFINED — ${created.title.toUpperCase()} — ${created.summary}`;
    },
    { fieldNames: DEFINITION_FORM_FIELDS },
  );
}

export async function updateDefinitionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'achievements.update_definition',
    async (ctx) => {
      const updated = await achievements.updateAchievementDefinition(ctx, {
        key: formString(data, 'key'),
        patch: definitionFields(data),
      });
      refresh();
      return `ACHIEVEMENT UPDATED — ${updated.title.toUpperCase()}.`;
    },
    { fieldNames: DEFINITION_FORM_FIELDS },
  );
}

export async function deleteDefinitionAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('achievements.delete_definition', async (ctx) => {
    const key = formString(data, 'key');
    const definition = await achievements.getAchievementDefinition(ctx, { key });
    await achievements.deleteAchievementDefinition(ctx, { key });
    refresh();
    return `ACHIEVEMENT DELETED — ${definition.title.toUpperCase()}.`;
  });
}

export async function seedStartersAction(_: ActionState): Promise<ActionState> {
  return runAction('achievements.seed', async (ctx) => {
    const result = await achievements.seedStarterAchievements(ctx);
    refresh();
    return result.created.length > 0
      ? `STARTER CATALOG INSTALLED — ${result.created.length} added, ${result.existing.length} already present. Existing history is evaluated in the background.`
      : 'STARTER CATALOG ALREADY INSTALLED — nothing changed.';
  });
}

// ── Awards (canAwardAchievements) ───────────────────────────────────────────

/** The award and revoke dialogs' member search: achievement staff only. */
export async function searchAwardableMembersAction(query: string): Promise<MemberSearchResult> {
  return runMemberSearch('canAwardAchievements', query);
}

/**
 * The picked member's active awards, so the award dialog offers what they
 * lack and the revoke dialog what they hold. Achievement staff only; the
 * member's profile visibility applies.
 */
export async function memberAwardsAction(memberId: string): Promise<HeldAwardsResult> {
  if (!(await isTrustedMutationRequest()))
    return { status: 'error', message: 'Request origin rejected.' };
  const { ctx } = await getRequestContext();
  if (!isUserContext(ctx))
    return { status: 'error', message: 'Your session has ended. Sign in again.' };
  try {
    await authorize(ctx, 'canAwardAchievements', { type: 'achievement' });
    if (typeof memberId !== 'string' || !isUuid(memberId))
      throw new ValidationError('Choose a member.');
    const held = await achievements.listMemberAchievements(ctx, { memberId });
    return {
      status: 'ok',
      held: held.map((award) => ({ key: award.key, title: award.title, verified: award.verified })),
    };
  } catch (error) {
    if (isJaveError(error)) return { status: 'error', message: error.userMessage };
    const reference = newErrorId();
    ctx.logger.error({ err: error, reference }, 'member awards lookup failed');
    return { status: 'error', message: `Lookup failed. Reference ${reference}.` };
  }
}

export async function awardAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'achievements.award',
    async (ctx) => {
      const member = await pickedMember(ctx, data);
      const award = await achievements.awardAchievement(ctx, {
        memberId: member.memberId,
        key: formString(data, 'key'),
        reason: formString(data, 'reason'),
      });
      refresh(member.memberId);
      const pending =
        award.verification === 'verified' ? '' : ' Pending verification by a second person.';
      const title = await titleOf(ctx, award.achievementKey);
      return `ACHIEVEMENT AWARDED — ${title} — ${member.displayName}.${pending}`;
    },
    { fieldNames: MEMBER_FIELDS },
  );
}

export async function revokeAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'achievements.revoke',
    async (ctx) => {
      const member = await pickedMember(ctx, data);
      const key = formString(data, 'key');
      await achievements.revokeAchievement(ctx, {
        memberId: member.memberId,
        key,
        reason: formString(data, 'reason'),
      });
      refresh(member.memberId);
      return `ACHIEVEMENT REVOKED — ${await titleOf(ctx, key)} — ${member.displayName}. The member is notified.`;
    },
    { fieldNames: MEMBER_FIELDS },
  );
}

export async function verifyAwardAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction('achievements.verify', async (ctx) => {
    const memberId = formString(data, 'memberId');
    const key = formString(data, 'key');
    await achievements.verifyMemberAchievement(ctx, { memberId, key });
    refresh(memberId);
    const member = await getProfile(ctx, { memberId });
    return `ACHIEVEMENT VERIFIED — ${await titleOf(ctx, key)} — ${member.displayName}.`;
  });
}
