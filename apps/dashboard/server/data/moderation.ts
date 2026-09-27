import 'server-only';
import {
  can,
  type Capability,
  getSettings,
  listMembers,
  type MemberListItem,
  moderation,
  NotFoundError,
  type Page,
  type ServiceContext,
  type Settings,
} from '@jave/core';
import type { CaseFilters, EventFilters } from '@/lib/moderation-labels';

/**
 * Read models for /moderation. Every read goes through the moderation
 * services with the request's ServiceContext, so authorization (capability,
 * hiding records about the viewer and higher-ranked staff) lives in core.
 */

export const CASES_PAGE_SIZE = 25;
export const EVENTS_PAGE_SIZE = 20;
export const LOOKUP_CANDIDATES = 8;

export type ModerationTab = 'cases' | 'security' | 'lookup' | 'raid';

/** Capability that makes each tab visible (the services re-check on every read). */
export const TAB_CAPABILITY: Record<ModerationTab, Capability> = {
  cases: 'canModerate',
  security: 'canViewSecurityEvents',
  lookup: 'canModerate',
  raid: 'canModerate',
};

export function visibleTabs(ctx: ServiceContext): ModerationTab[] {
  return (Object.keys(TAB_CAPABILITY) as ModerationTab[]).filter((tab) =>
    can(ctx, TAB_CAPABILITY[tab]),
  );
}

export interface ModerationSummary {
  raidMode: boolean;
  /** Security events open or acknowledged (null when the viewer cannot see events). */
  needsReview: number | null;
  quarantined: number;
  banned: number;
}

export async function loadModerationSummary(ctx: ServiceContext): Promise<ModerationSummary> {
  const [security, quarantined, banned, events] = await Promise.all([
    getSettings(ctx, 'security'),
    moderation.listCases(ctx, { action: 'quarantine', liveOnly: true, limit: 1 }),
    moderation.listCases(ctx, { action: 'ban', liveOnly: true, limit: 1 }),
    can(ctx, 'canViewSecurityEvents')
      ? moderation.listSecurityEvents(ctx, { status: ['open', 'acknowledged'], limit: 1 })
      : Promise.resolve(null),
  ]);
  return {
    raidMode: security.raidMode,
    needsReview: events?.total ?? null,
    quarantined: quarantined.total,
    banned: banned.total,
  };
}

export function loadCases(
  ctx: ServiceContext,
  filters: CaseFilters,
): Promise<Page<moderation.ModCaseView>> {
  return moderation.listCases(ctx, {
    number: filters.number,
    action: filters.action,
    source: filters.source,
    liveOnly: filters.state === 'live',
    includeRevoked: filters.state !== 'standing',
    limit: CASES_PAGE_SIZE,
    offset: filters.offset,
  });
}

export function loadSecurityEvents(
  ctx: ServiceContext,
  filters: EventFilters,
): Promise<Page<moderation.SecurityEventView>> {
  return moderation.listSecurityEvents(ctx, {
    status: filters.statuses,
    trigger: filters.trigger,
    minRiskScore: filters.minRisk,
    limit: EVENTS_PAGE_SIZE,
    offset: filters.offset,
  });
}

/** Risk thresholds the alert card uses (critical = the quarantine threshold). */
export async function loadRiskThresholds(
  ctx: ServiceContext,
): Promise<{ critical: number; elevated: number }> {
  const settings = await getSettings(ctx, 'moderation');
  return { critical: settings.quarantineRiskScore, elevated: moderation.ELEVATED_RISK_SCORE };
}

export interface LookupResult {
  /** The selected member's record, when one is selected (or the query was a Discord ID). */
  history: moderation.CaseHistory | null;
  /** Members matching a name query, to pick from. */
  candidates: MemberListItem[];
}

/**
 * Member lookup: a Discord ID opens that user's record directly (including
 * people who never joined but were banned); anything else searches members
 * by name or handle. Records about the viewer or higher-ranked staff read as
 * not found in core, and the page shows them as "no record".
 */
export async function loadLookup(
  ctx: ServiceContext,
  input: { query: string | undefined; discordId: string | undefined },
): Promise<LookupResult> {
  if (input.discordId) {
    const history = await moderation
      .getCaseHistory(ctx, { targetDiscordId: input.discordId })
      .catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      });
    return { history, candidates: [] };
  }
  if (!input.query) return { history: null, candidates: [] };
  const page = await listMembers(ctx, { search: input.query, limit: LOOKUP_CANDIDATES });
  return { history: null, candidates: page.items };
}

export interface PostureView {
  security: Settings<'security'>;
  automod: Settings<'moderation'>;
  quarantineRoleConfigured: boolean;
  alertChannelConfigured: boolean;
}

export async function loadPosture(ctx: ServiceContext): Promise<PostureView> {
  const [security, automod, roles, channels] = await Promise.all([
    getSettings(ctx, 'security'),
    getSettings(ctx, 'moderation'),
    getSettings(ctx, 'roles'),
    getSettings(ctx, 'channels'),
  ]);
  return {
    security,
    automod,
    quarantineRoleConfigured: Boolean(roles.quarantineRoleId),
    // Alert cards post only to the security alerts channel (raid notices fall back to staff alerts).
    alertChannelConfigured: Boolean(channels.securityAlerts),
  };
}
