'use server';

import { revalidatePath } from 'next/cache';
import {
  claimRank,
  NOTIFICATION_TYPE_KEYS,
  requireMember,
  updateMyPreferences,
  updateProfile,
  ValidationError,
} from '@jave/core';
import { CAPABILITY_DOMAINS } from '@jave/database';
import type { ActionState } from '@/lib/action-state';
import { formBoolean, formEnum, formOptional, formString } from '@/lib/form-data';
import { VISIBILITY_LABELS } from '@/lib/member-labels';
import { timeToMinutes } from '@/lib/time';
import { runAction } from '@/server/actions';

const DOMAIN_KEYS = CAPABILITY_DOMAINS.map((domain) => domain.key);
const VISIBILITIES = Object.keys(VISIBILITY_LABELS) as (keyof typeof VISIBILITY_LABELS)[];

const PROFILE_FIELDS = [
  'displayName',
  'handle',
  'headline',
  'bio',
  'primaryDomain',
  'profileVisibility',
] as const;

export async function updateProfileAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'me.update_profile',
    async (ctx) => {
      const actor = requireMember(ctx);
      const primaryDomain = formString(data, 'primaryDomain');
      await updateProfile(ctx, actor.memberId, {
        displayName: formString(data, 'displayName'),
        handle: formString(data, 'handle'),
        headline: formString(data, 'headline'),
        bio: formString(data, 'bio'),
        primaryDomain: primaryDomain === '' ? null : formEnum(data, 'primaryDomain', DOMAIN_KEYS),
        profileVisibility: formEnum(data, 'profileVisibility', VISIBILITIES),
        showClaimsPublicly: formBoolean(data, 'showClaimsPublicly'),
        showOnLeaderboards: formBoolean(data, 'showOnLeaderboards'),
      });
      revalidatePath('/', 'layout');
      return 'Profile saved.';
    },
    { fieldNames: PROFILE_FIELDS },
  );
}

export async function claimRankAction(_: ActionState, data: FormData): Promise<ActionState> {
  return runAction(
    'me.claim_rank',
    async (ctx) => {
      const rank = formOptional(data, 'rank') ?? null;
      const evidenceTitle = formOptional(data, 'evidenceTitle');
      const evidenceUrl = formOptional(data, 'evidenceUrl');
      const evidenceDescription = formOptional(data, 'evidenceDescription');
      if (!evidenceTitle && (evidenceUrl || evidenceDescription)) {
        throw new ValidationError('Give the evidence a title.', [
          { path: 'evidence.title', message: 'Required when you attach evidence.' },
        ]);
      }
      await claimRank(ctx, {
        facetKey: formString(data, 'facetKey'),
        rank,
        evidence: evidenceTitle
          ? { title: evidenceTitle, url: evidenceUrl, description: evidenceDescription }
          : undefined,
      });
      revalidatePath('/me');
      return rank
        ? `CLAIM RECORDED — ${rank}. It stays CLAIMED until an evaluator verifies it.`
        : 'Claim withdrawn.';
    },
    { fieldNames: ['rank', 'evidence.title', 'evidence.url', 'evidence.description'] },
  );
}

export async function updatePreferencesAction(
  _: ActionState,
  data: FormData,
): Promise<ActionState> {
  return runAction(
    'me.update_preferences',
    async (ctx) => {
      let quietHours: { start: number; end: number } | null = null;
      if (formBoolean(data, 'quietHours.enabled')) {
        const start = timeToMinutes(formString(data, 'quietHours.start'));
        const end = timeToMinutes(formString(data, 'quietHours.end'));
        if (start === null || end === null) {
          throw new ValidationError('Quiet hours need a start and an end.', [
            { path: 'quietHours', message: 'Use 24-hour times, e.g. 22:00 and 07:00.' },
          ]);
        }
        quietHours = { start, end };
      }
      const offered = new Set(
        data.getAll('notificationType').filter((v): v is string => typeof v === 'string'),
      );
      await updateMyPreferences(ctx, {
        timezone: formString(data, 'timezone'),
        quietHours,
        dmNotifications: formBoolean(data, 'dmNotifications'),
        channels: NOTIFICATION_TYPE_KEYS.filter((type) => offered.has(type)).map((type) => ({
          type,
          channel: 'discord_dm' as const,
          enabled: formBoolean(data, `notify.${type}`),
        })),
      });
      revalidatePath('/', 'layout');
      return 'Preferences saved.';
    },
    { fieldNames: ['timezone', 'quietHours'] },
  );
}
