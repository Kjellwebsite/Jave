import { ai, can, getSettings } from '@jave/core';
import { ProviderPanel } from '@/components/ai/provider-panel';
import { MemberUsagePanel, OrgUsagePanel, YourUsagePanel } from '@/components/ai/usage-panels';
import { formatTimestamp } from '@/lib/time';
import type { UserContext } from '@/server/context';
import { getIntegrations, getProviderStatus } from '@/server/ai';

/** Members listed in the per-member usage table (heaviest first). */
const MEMBER_USAGE_ROWS = 25;
const TODAY = 1;

/** Provider status, the viewer's usage today, and — by capability — organization usage. */
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
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ProviderPanel
          state={status.state}
          provider={status.provider}
          model={status.model}
          isMock={integrations.aiIsMock}
          settings={{
            enabled: settings.enabled,
            dailyLimit: mine.limit,
            maxInputChars: settings.maxInputChars,
            proposalTtlMinutes: settings.proposalTtlMinutes,
          }}
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
        <YourUsagePanel
          usage={{
            used: mine.used,
            limit: mine.limit,
            remaining: mine.remaining,
            enabled: mine.enabled,
            resetsAt: `${formatTimestamp(mine.resetsAt, timeZone)} · 00:00 UTC`,
          }}
        />
      </div>
      {org ? <OrgUsagePanel usage={org} /> : null}
      {perMember ? <MemberUsagePanel rows={perMember} limit={mine.limit} /> : null}
    </div>
  );
}
