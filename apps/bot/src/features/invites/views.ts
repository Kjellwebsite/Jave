import type { APIEmbedField, APISelectMenuOption } from 'discord.js';
import type { invites } from '@jave/core';
import type { ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, panel, row, stringSelect } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';

/** Custom id namespace of this feature (components and modals). */
export const INVITES_NS = 'invites';

/** Recent referrals shown on the member card. */
const RECENT_REFERRALS_SHOWN = 5;
/** Leaderboard rows rendered in one card. */
export const LEADERBOARD_ROWS = 10;
const PERCENT = 100;
const LABEL_WIDTH = 10;
const POSITION_DIGITS = 2;

export const LEADERBOARD_PERIODS = ['all', '90', '30', '7'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
  all: 'All time',
  '90': 'Last 90 days',
  '30': 'Last 30 days',
  '7': 'Last 7 days',
};

export function isLeaderboardPeriod(value: string | undefined): value is LeaderboardPeriod {
  return (LEADERBOARD_PERIODS as readonly string[]).includes(value ?? '');
}

export function periodDays(period: LeaderboardPeriod): 7 | 30 | 90 | undefined {
  return period === 'all' ? undefined : (Number(period) as 7 | 30 | 90);
}

const METHOD_LABELS: Record<string, string> = {
  invite: 'invite link',
  vanity: 'vanity URL',
  referral_code: 'referral code',
  unknown: 'source unknown',
};

function percent(rate: number | null): string {
  return rate === null ? '' : `${Math.round(rate * PERCENT)}% of joined`;
}

/** INVITED → JOINED → RETAINED → VALID as an aligned monospace block. */
export function funnelBlock(funnel: invites.ReferralFunnel): string {
  const rows: [string, number, string][] = [
    ['INVITED', funnel.invited, ''],
    ['JOINED', funnel.joined, ''],
    ['RETAINED', funnel.retained, percent(funnel.retentionRate)],
    ['VALID', funnel.valid, percent(funnel.validRate)],
  ];
  const width = Math.max(...rows.map(([, value]) => String(value).length));
  const lines = rows.map(([label, value, note]) =>
    `${label.padEnd(LABEL_WIDTH)}${String(value).padStart(width)}${note ? `   ${note}` : ''}`.trimEnd(),
  );
  return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

function exitsLine(funnel: invites.ReferralFunnel): string {
  return [
    `LEFT ${funnel.left}`,
    `INVALID ${funnel.invalid}`,
    `UNDER REVIEW ${funnel.flagged}`,
  ].join(` ${GLYPH.dot} `);
}

function referralLine(referral: invites.MyReferral): string {
  const status =
    referral.status === 'valid' ? `VALID ${GLYPH.verified}` : referral.status.toUpperCase();
  const review = referral.underReview ? ` ${GLYPH.dot} under review` : '';
  return `${GLYPH.bullet} ${userText(referral.inviteeName, 64)} — ${status} ${GLYPH.dot} ${
    METHOD_LABELS[referral.method] ?? referral.method
  } ${GLYPH.dot} joined ${discordTime(referral.joinedAt)}${review}`;
}

export interface LifecycleRules {
  retentionDays: number;
  validRequiresOnboarding: boolean;
}

function lifecycleCopy(rules: LifecycleRules): string {
  const valid = rules.validRequiresOnboarding
    ? 'VALID once they have also completed onboarding'
    : 'VALID after review of the join';
  return `A referral becomes RETAINED after ${rules.retentionDays} days in the server, then ${valid}. Only VALID referrals count.`;
}

/** The member's own referral card (ephemeral). */
export function renderMine(view: invites.MyReferralsView, rules: LifecycleRules): ReplyPayload {
  const activeCodes = view.codes.filter((code) => code.active);
  const fields: APIEmbedField[] = [
    field('Funnel', funnelBlock(view.funnel)),
    field('Exits', exitsLine(view.funnel)),
    field(
      'Referral codes',
      activeCodes.length > 0
        ? activeCodes.map((code) => `\`${code.code}\` ${GLYPH.dot} ${code.claims} used`).join('\n')
        : 'No active code. Create one to credit people you bring in.',
    ),
    field(
      'Recent referrals',
      view.referrals.length > 0
        ? view.referrals.slice(0, RECENT_REFERRALS_SHOWN).map(referralLine).join('\n')
        : 'None yet.',
    ),
    field(
      'Leaderboard',
      view.showOnLeaderboards
        ? 'Listed when you hold VALID referrals.'
        : 'Hidden — you opted out of leaderboards.',
    ),
  ];
  return {
    embeds: [
      panel({
        kicker: 'JVLN REFERRALS',
        title: 'Your referral funnel',
        description: lifecycleCopy(rules),
        fields,
      }),
    ],
    components: [
      row(
        button('Referral code', customId(INVITES_NS, 'codes'), 'primary'),
        button('Leaderboard', customId(INVITES_NS, 'board', 'all')),
      ),
    ],
    ephemeral: true,
  };
}

export interface CodesViewOptions {
  maxActive: number;
  claimWindowDays: number;
  /** Offer "enter a code" (hint only: core decides eligibility). */
  canEnterCode: boolean;
  /** Optional result banner, e.g. after creating a code. */
  notice?: { title: string; description: string };
}

/** The member's referral codes with create / deactivate / claim controls (ephemeral). */
export function renderCodes(
  view: invites.MyReferralsView,
  options: CodesViewOptions,
): ReplyPayload {
  const personal = view.codes.filter((code) => code.active && code.campaignId === null);
  const active = view.codes.filter((code) => code.active);
  const inactive = view.codes.filter((code) => !code.active);
  const lines = active.map(
    (code) =>
      `\`${code.code}\` ${GLYPH.dot} ${code.claims} used ${GLYPH.dot} created ${discordTime(code.createdAt, 'd')}${
        code.campaignId ? ` ${GLYPH.dot} campaign` : ''
      }`,
  );
  const fields: APIEmbedField[] = [
    field('Active', lines.length > 0 ? lines.join('\n') : 'None.'),
    field(
      'How it works',
      `New members enter your code with \`/invites code\` → ENTER A CODE within ${options.claimWindowDays} days of joining. It credits you even when they used another invite link.`,
    ),
  ];
  if (inactive.length > 0) {
    fields.push(field('Deactivated', `${inactive.length} code${inactive.length === 1 ? '' : 's'}`));
  }
  if (view.usedCode) fields.push(field('You joined with', `\`${view.usedCode}\``));
  const embeds = [
    panel({
      kicker: 'JVLN REFERRALS',
      title: 'Referral codes',
      description: `Personal codes: ${personal.length} of ${options.maxActive} active.`,
      fields,
    }),
  ];
  if (options.notice) {
    embeds.unshift(
      panel({
        title: `${GLYPH.verified} ${options.notice.title}`,
        description: options.notice.description,
        color: COLORS.success,
      }),
    );
  }
  const buttons = [];
  if (personal.length < options.maxActive) {
    buttons.push(button('New code', customId(INVITES_NS, 'code-new'), 'primary'));
  }
  if (options.canEnterCode) buttons.push(button('Enter a code', customId(INVITES_NS, 'claim')));
  buttons.push(button('Funnel', customId(INVITES_NS, 'mine')));
  const components: NonNullable<ReplyPayload['components']> = [row(...buttons)];
  if (active.length > 0) {
    const choices: APISelectMenuOption[] = active.map((code) => ({
      label: code.code,
      value: code.code,
      description: `${code.claims} used`,
    }));
    components.unshift(
      row(stringSelect(customId(INVITES_NS, 'code-off'), 'Deactivate a code', choices)),
    );
  }
  return { embeds, components, ephemeral: true };
}

function position(rank: number): string {
  return String(rank).padStart(POSITION_DIGITS, '0');
}

/** VALID-only referral leaderboard. Public cards carry no controls. */
export function renderLeaderboard(
  entries: readonly invites.LeaderboardEntry[],
  period: LeaderboardPeriod,
  options: { ephemeral: boolean },
): ReplyPayload {
  const description =
    entries.length > 0
      ? entries
          .map(
            (entry) =>
              `\`${position(entry.rank)}\` **${userText(entry.displayName, 64)}** @${userText(entry.handle, 32)} ${GLYPH.dot} ${entry.validReferrals} valid`,
          )
          .join('\n')
      : 'No VALID referrals in this period yet.';
  const embed = panel({
    kicker: `REFERRALS ${GLYPH.dot} ${PERIOD_LABELS[period].toUpperCase()}`,
    title: 'Referral leaderboard',
    description,
    footer:
      'VALID referrals only — people who joined and stayed. Opt out on your JVLN profile page.',
  });
  if (!options.ephemeral) return { embeds: [embed], ephemeral: false };
  return {
    embeds: [embed],
    components: [
      row(
        stringSelect(
          customId(INVITES_NS, 'board-period'),
          'Period',
          LEADERBOARD_PERIODS.map((value) => ({
            label: PERIOD_LABELS[value],
            value,
            default: value === period,
          })),
        ),
      ),
    ],
    ephemeral: true,
  };
}

/**
 * A member's funnel for the context menu. Anomaly detail (fast leaves) is
 * staff-only: inviters see only how many referrals are under review.
 */
export function renderMemberFunnel(
  name: string,
  funnel: invites.ReferralFunnel,
  options: { staffView: boolean },
): ReplyPayload {
  const exits = options.staffView
    ? `${exitsLine(funnel)} ${GLYPH.dot} FAST LEAVES ${funnel.fastLeaves}`
    : exitsLine(funnel);
  return {
    embeds: [
      panel({
        kicker: 'JVLN REFERRALS',
        title: `Referral funnel ${GLYPH.dot} ${userText(name, 64)}`,
        fields: [
          field('Funnel', funnelBlock(funnel)),
          field('Exits', exits),
          field(
            'Invited',
            `${funnel.inviteUses} invite uses ${GLYPH.dot} ${funnel.codeClaims} code claims`,
          ),
        ],
      }),
    ],
    ephemeral: true,
  };
}
