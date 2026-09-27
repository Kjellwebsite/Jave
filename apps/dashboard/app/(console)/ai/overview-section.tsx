import { ai, can, getSettings } from '@jave/core';
import { DiscordGuidePanel } from '@/components/ai/discord-guide';
import { LimitsPanel, ProviderPanel } from '@/components/ai/provider-panel';
import { MemberUsagePanel, OrgUsagePanel, YourUsagePanel } from '@/components/ai/usage-panels';
import { formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';
import { getIntegrations, getProviderStatus } from '@/server/ai';

/** Members listed in the per-member usage table (heaviest first). */
const MEMBER_USAGE_ROWS = 25;
const TODAY = 1;

/**
 * Provider status, the viewer's usage today and the limits, where to use
 * JAVE AI in Discord, and — by capability — organization and per-member usage.
 */
export async function OverviewSection({ ctx, timeZone }: { ctx: UserContext; timeZone: string }) {
  const integrations = getIntegrations();
  const diagnostics = can(ctx, 'canViewSystemStatus');
  const [status, settings, mine, org, perMember] = await Promise.all([
    getProviderStatus(),
    getSettings(ctx, 'ai'),
    ai.getUsage(ctx, integrations.ai),
    can(ctx, 'canViewAnalytics') ? ai.getOrgUsage(ctx, { days: TODAY }) : null,
    can(ctx, 'canViewAuditLogs') ? ai.getUsageByUser(ctx, { limit: MEMBER_USAGE_ROWS }) : null,
  ]);

  return (
    <div className="space-y-8">
      {/* Phones read provider → your usage → limits → Discord guide; desktop keeps two columns. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <ProviderPanel
            state={status.state}
            provider={status.provider}
            model={status.model}
            isMock={integrations.aiIsMock}
            diagnostics={
              diagnostics
                ? {
                    detail: status.detail,
                    checkedAt: formatTimestamp(status.checkedAt, timeZone),
                    configurationError: integrations.aiConfigurationError,
                  }
                : null
            }
          />
        </div>
        <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <YourUsagePanel
            usage={{
              used: mine.used,
              limit: mine.limit,
              remaining: mine.remaining,
              enabled: mine.enabled,
              resetsAt: formatTimestamp(mine.resetsAt, timeZone),
            }}
          />
          <LimitsPanel
            limits={{
              enabled: settings.enabled,
              dailyLimit: mine.limit,
              maxInputChars: settings.maxInputChars,
              proposalTtlMinutes: settings.proposalTtlMinutes,
            }}
          />
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <DiscordGuidePanel
            canSaveResearch={can(ctx, 'canViewMembers')}
            canDraftTasks={can(ctx, 'canManageMissions')}
          />
        </div>
      </div>
      {org ? <OrgUsagePanel usage={org} /> : null}
      {perMember ? <MemberUsagePanel rows={perMember} limit={mine.limit} /> : null}
    </div>
  );
}
