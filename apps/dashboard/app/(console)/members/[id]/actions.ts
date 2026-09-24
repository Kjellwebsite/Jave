'use server';

import { revalidatePath } from 'next/cache';
import {
  addMemberNote,
  getMemberById,
  grantRole,
  isUuid,
  loadCatalog,
  type OrgRole,
  revokeRole,
  ROLE_KEYS,
  setEvaluatorNotes,
  setVerifiedRank,
  ValidationError,
} from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formEnum, formOptional, formString } from '@/lib/form-data';
import { runAction } from '@/server/actions';
import type { UserContext } from '@/server/context';

async function targetMember(ctx: UserContext, data: FormData) {
  const memberId = formString(data, 'memberId');
  if (!isUuid(memberId)) throw new ValidationError('Unknown member.');
  return getMemberById(ctx, memberId);
}

function chosenRole(data: FormData): OrgRole {
  const role = formEnum(data, 'role', ROLE_KEYS);
  if (!role)
    throw new ValidationError('Choose a role.', [{ path: 'role', message: 'Choose a role.' }]);
  return role;
}

function refresh(memberId: string): void {
  revalidatePath(`/members/${memberId}`);
  revalidatePath('/members');
}

export async function grantRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'member.grant_role',
    async (ctx) => {
      const member = await targetMember(ctx, data);
      const role = chosenRole(data);
      await grantRole(ctx, { memberId: member.id, role, reason: formString(data, 'reason') });
      refresh(member.id);
      return `ROLE GRANTED — ${role.toUpperCase()} — ${member.displayName}.`;
    },
    { fieldNames: ['role', 'reason'] },
  );
}

export async function revokeRoleAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'member.revoke_role',
    async (ctx) => {
      const member = await targetMember(ctx, data);
      const role = chosenRole(data);
      await revokeRole(ctx, { memberId: member.id, role, reason: formString(data, 'reason') });
      refresh(member.id);
      return `ROLE REVOKED — ${role.toUpperCase()} — ${member.displayName}.`;
    },
    { fieldNames: ['role', 'reason'] },
  );
}

export async function setVerifiedRankAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'member.set_verified_rank',
    async (ctx) => {
      const member = await targetMember(ctx, data);
      const facetKey = formString(data, 'facetKey');
      const rank = formOptional(data, 'rank') ?? null;
      const evidenceId = formOptional(data, 'evidenceId');
      const result = await setVerifiedRank(ctx, {
        memberId: member.id,
        facetKey,
        rank,
        reason: formString(data, 'reason'),
        evidenceId,
      });
      refresh(member.id);
      const catalog = await loadCatalog(ctx);
      const facet =
        catalog.facets.find((candidate) => candidate.key === facetKey)?.label ?? facetKey;
      if (!result.changed) return `${facet.toUpperCase()} — unchanged.`;
      return rank
        ? `RANK VERIFIED — ${facet.toUpperCase()} — ${rank}.`
        : `VERIFIED RANK CLEARED — ${facet.toUpperCase()}.`;
    },
    { fieldNames: ['rank', 'reason', 'evidenceId'] },
  );
}

export async function setEvaluatorNotesAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'member.set_evaluator_notes',
    async (ctx) => {
      const member = await targetMember(ctx, data);
      await setEvaluatorNotes(ctx, {
        memberId: member.id,
        facetKey: formString(data, 'facetKey'),
        notes: formString(data, 'notes'),
      });
      refresh(member.id);
      return 'Evaluator notes saved.';
    },
    { fieldNames: ['notes'] },
  );
}

export async function addNoteAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'member.add_note',
    async (ctx) => {
      const member = await targetMember(ctx, data);
      await addMemberNote(ctx, member.id, formString(data, 'body'));
      refresh(member.id);
      return 'Note added.';
    },
    { fieldNames: ['body'] },
  );
}
