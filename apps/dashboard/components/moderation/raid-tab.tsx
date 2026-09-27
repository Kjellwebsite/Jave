import type { ReactNode } from 'react';
import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { can, moderation, type ServiceContext } from '@jave/core';
import {
  buttonStyles,
  Callout,
  cx,
  Icon,
  isRoleKey,
  Mono,
  Panel,
  RoleBadge,
  StatusBadge,
} from '@jave/ui';
import { loadPosture } from '@/server/data/moderation';
import type { FormAction } from '../forms/action-form';
import { RaidModeControl } from './moderation-dialogs';

const LINK_MODE_LABELS = {
  off: 'Off',
  denylist: 'Denylist',
  allowlist: 'Allowlist only',
} as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 px-5 py-3 sm:grid-cols-[220px_minmax(0,1fr)]">
      <dt className="text-small text-fg-muted">{label}</dt>
      <dd className="min-w-0 justify-self-end text-right text-small text-fg sm:justify-self-start sm:text-left">
        {children}
      </dd>
    </div>
  );
}

function OnOff({ value }: { value: boolean }) {
  return <StatusBadge quiet tone={value ? 'success' : 'neutral'} label={value ? 'On' : 'Off'} />;
}

function SettingsLink({ section, label }: { section: string; label: string }) {
  return (
    <Link
      href={`/settings?section=${section}`}
      className={buttonStyles({ variant: 'ghost', size: 'sm' })}
    >
      <Icon icon={Settings2} size="sm" />
      {label}
    </Link>
  );
}

export interface RaidTabProps {
  ctx: ServiceContext;
  raidAction: FormAction;
}

/** Raid mode (switchable with canManageSecurity) and a read-only summary of screening and automod. */
export async function RaidTab({ ctx, raidAction }: RaidTabProps) {
  const posture = await loadPosture(ctx);
  const { security, automod } = posture;
  const canSwitch = can(ctx, 'canManageSecurity');
  const canEdit = can(ctx, 'canViewSettings');

  return (
    <div className="space-y-6">
      <section
        aria-label="Raid mode"
        className={cx(
          'machined relative flex flex-col gap-5 rounded-lg border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6',
          security.raidMode ? 'border-danger/35' : 'border-line',
        )}
      >
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="type-heading text-fg">Raid mode</h2>
            <StatusBadge
              tone={security.raidMode ? 'danger' : 'neutral'}
              live={security.raidMode}
              label={security.raidMode ? 'On' : 'Off'}
              data-testid="raid-state"
            />
          </div>
          <p className="max-w-xl text-small text-fg-subtle">
            {security.raidMode
              ? 'Every new join is quarantined for review. Staff release held members from their record.'
              : `Off. ${security.autoRaidMode ? `Switches on automatically at ${security.joinBurstCount} joins within ${security.joinBurstWindowSeconds}s.` : 'Automatic raid detection is off.'}`}
          </p>
        </div>
        {canSwitch ? (
          <div className="shrink-0">
            <RaidModeControl enabled={security.raidMode} raidAction={raidAction} />
          </div>
        ) : (
          <p className="shrink-0 text-small text-fg-subtle">
            Switching requires <Mono>canManageSecurity</Mono>.
          </p>
        )}
      </section>

      {!posture.quarantineRoleConfigured ? (
        <Callout tone="warning" title="No quarantine role">
          Quarantines fall back to Discord timeouts, which end after 28 days at most. Set a
          quarantine role in Settings → Roles for indefinite holds.
        </Callout>
      ) : null}
      {!posture.alertChannelConfigured ? (
        <Callout tone="info" title="No security alerts channel">
          Security alert cards are not posted in Discord. Events still appear here and notify staff.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel
          title="Join screening"
          description="Applied to every join by the bot."
          actions={canEdit ? <SettingsLink section="security" label="Edit" /> : null}
          flush
        >
          <dl className="divide-y divide-line-subtle">
            <Row label="Join burst">
              <Mono>
                {security.joinBurstCount} joins / {security.joinBurstWindowSeconds}s
              </Mono>
            </Row>
            <Row label="Automatic raid mode">
              <OnOff value={security.autoRaidMode} />
            </Row>
            <Row label="New account">
              <Mono>&lt; {security.suspiciousAccountAgeDays} days</Mono>
            </Row>
            <Row label="Hold suspicious joins">
              <OnOff value={security.quarantineSuspiciousJoins} />
            </Row>
          </dl>
        </Panel>

        <Panel
          title="Automod"
          description="Evaluated on every message; staff roles are exempt."
          actions={canEdit ? <SettingsLink section="moderation" label="Edit" /> : null}
          flush
        >
          <dl className="divide-y divide-line-subtle">
            <Row label="Automod">
              <OnOff value={automod.automodEnabled} />
            </Row>
            <Row label="Spam rate">
              <Mono>
                {automod.spam.maxMessages} msgs / {automod.spam.windowSeconds}s
              </Mono>
            </Row>
            <Row label="Duplicates">
              <Mono>{automod.spam.duplicateThreshold}× same text</Mono>
            </Row>
            <Row label="Mentions">
              <Mono>max {automod.maxMentions}</Mono>
            </Row>
            <Row label="Links">
              {LINK_MODE_LABELS[automod.links.mode]}
              <Mono dim className="ml-2 text-[12px]">
                {automod.links.denylist.length} denied · {automod.links.allowlist.length} allowed
              </Mono>
            </Row>
            <Row label="Foreign invites">
              <StatusBadge
                quiet
                tone={automod.blockForeignInvites ? 'success' : 'neutral'}
                label={automod.blockForeignInvites ? 'Blocked' : 'Allowed'}
              />
            </Row>
            <Row label="Spam timeout">
              <Mono>{moderation.formatDuration(automod.spamTimeoutSeconds)}</Mono>
            </Row>
            <Row label="Quarantine at risk">
              <Mono>{automod.quarantineRiskScore}/100</Mono>
            </Row>
            <Row label="Exempt roles">
              {automod.exemptRoles.length === 0 ? (
                <span className="text-fg-subtle">None</span>
              ) : (
                <span className="inline-flex flex-wrap justify-end gap-1.5 sm:justify-start">
                  {automod.exemptRoles.filter(isRoleKey).map((role) => (
                    <RoleBadge key={role} role={role} size="sm" />
                  ))}
                </span>
              )}
            </Row>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
