'use server';

import { revalidatePath } from 'next/cache';
import { achievements, getProfile, NotFoundError, ValidationError } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { DEFINITION_FORM_FIELDS, definitionFields, handleFrom } from '@/lib/achievement-form';
import { formString } from '@/lib/form-data';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';

const PAGE = '/achievements';
const MEMBER_FIELDS = ['handle', 'key', 'reason'] as const;

function refresh(): void {
  revalidatePath(PAGE);
}

/** "MENTOR" for copy; achievement staff see every definition unmasked. */
async function titleOf(ctx: UserContext, key: string): Promise<string> {
  const catalog = await achievements.getAchievementCatalog(ctx, {});
  const entry = catalog.find((candidate) => !candidate.masked && candidate.key === key);
  return (entry && !entry.masked ? entry.title : key).toUpperCase();
}

/** The member a manual award is about, by handle. Profile visibility rules apply. */
async function memberByHandle(ctx: UserContext, data: FormData) {
  const handle = handleFrom(data);
  if (!handle)
    throw new ValidationError('Enter a member handle.', [
      { path: 'handle', message: 'Enter a member handle.' },
    ]);
  try {
    return await getProfile(ctx, { handle });
  } catch (error) {
    if (error instanceof NotFoundError)
      throw new ValidationError('No member with that handle.', [
        { path: 'handle', message: 'No member with that handle.' },
      ]);
    throw error;
  }
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
    await achievements.deleteAchievementDefinition(ctx, { key });
    refresh();
    return `ACHIEVEMENT DELETED — ${key}.`;
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

export async function awardAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'achievements.award',
    async (ctx) => {
      const member = await memberByHandle(ctx, data);
      const award = await achievements.awardAchievement(ctx, {
        memberId: member.memberId,
        key: formString(data, 'key'),
        reason: formString(data, 'reason'),
      });
      refresh();
      revalidatePath(`/members/${member.memberId}`);
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
      const member = await memberByHandle(ctx, data);
      const key = formString(data, 'key');
      await achievements.revokeAchievement(ctx, {
        memberId: member.memberId,
        key,
        reason: formString(data, 'reason'),
      });
      refresh();
      revalidatePath(`/members/${member.memberId}`);
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
    refresh();
    revalidatePath(`/members/${memberId}`);
    const member = await getProfile(ctx, { memberId });
    return `ACHIEVEMENT VERIFIED — ${await titleOf(ctx, key)} — ${member.displayName}.`;
  });
}
