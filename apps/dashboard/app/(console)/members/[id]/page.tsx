import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import {
  assignableRoles,
  can,
  getProfile,
  getRankHistory,
  getRole,
  isUuid,
  listEvidence,
  listMemberCapabilitiesForEvaluator,
  listMemberNotes,
  loadCatalog,
  type ProfileView,
} from '@jave/core';
import {
  Avatar,
  RestrictedState,
  Icon,
  LinkTabs,
  Mono,
  RoleBadge,
  StatusBadge,
  buttonStyles,
} from '@jave/ui';
import { AchievementGrid } from '@/components/members/achievement-grid';
import { CapabilityMatrix, type EvaluatorContext } from '@/components/members/capability-matrix';
import { EvidenceList } from '@/components/members/evidence-list';
import { RankHistory } from '@/components/members/rank-history';
import { RoleManager, type RoleRow } from '@/components/members/role-manager';
import { StaffNotes } from '@/components/members/staff-notes';
import { StatStrip } from '@/components/members/stat-strip';
import { VerifiedMark } from '@/components/members/verified-mark';
import { NextLink } from '@/components/next-link';
import {
  GUILD_STATUS_LABELS,
  GUILD_STATUS_TONE,
  STANDING_LABELS,
  STANDING_TONE,
  VISIBILITY_LABELS,
} from '@/lib/member-labels';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { formatDate } from '@/lib/time';
import { requireConsoleContext, type UserContext } from '@/server/context';
import { loadRoleGrants } from '@/server/data/member-roles';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import {
  addNoteAction,
  grantRoleAction,
  revokeRoleAction,
  setEvaluatorNotesAction,
  setVerifiedRankAction,
} from './actions';

export const metadata: Metadata = { title: 'Member' };

const TABS = ['capability', 'roles', 'history', 'evidence', 'notes', 'achievements'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  capability: 'Capability',
  roles: 'Roles',
  history: 'Rank history',
  evidence: 'Evidence',
  notes: 'Staff notes',
  achievements: 'Achievements',
};

interface Permissions {
  evaluate: boolean;
  viewHistory: boolean;
  viewEvidence: boolean;
  viewNotes: boolean;
  addNotes: boolean;
}

function permissionsFor(ctx: UserContext, profile: ProfileView): Permissions {
  const self = profile.isSelf;
  return {
    evaluate: can(ctx, 'canModifyRanks') && !self,
    viewHistory: self || can(ctx, 'canViewRankHistory'),
    viewEvidence: self || can(ctx, 'canVerifyMembers') || can(ctx, 'canModifyRanks'),
    viewNotes: can(ctx, 'canViewPrivateProfiles'),
    addNotes: can(ctx, 'canManageMembers') && !self,
  };
}

function availableTabs(permissions: Permissions): Tab[] {
  return TABS.filter((tab) => {
    if (tab === 'history') return permissions.viewHistory;
    if (tab === 'evidence') return permissions.viewEvidence;
    if (tab === 'notes') return permissions.viewNotes;
    return true;
  });
}

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { ctx } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const loaded = await guarded(() => getProfile(ctx, { memberId: id }));
  if (!loaded.ok) notFound();
  const profile = loaded.value;
  const [viewer, catalog] = await Promise.all([loadViewer(ctx), loadCatalog(ctx)]);
  const permissions = permissionsFor(ctx, profile);
  const tabs = availableTabs(permissions);
  const requested = firstParam((await searchParams).tab) as Tab | undefined;
  const tab: Tab = requested && tabs.includes(requested) ? requested : 'capability';
  const facetLabels = Object.fromEntries(catalog.facets.map((facet) => [facet.key, facet.label]));
  const tz = viewer.timeZone;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-6 border-b border-line-subtle pb-8 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-start gap-5">
          <Avatar name={profile.displayName} src={profile.avatarUrl} size="xl" />
          <div className="min-w-0 space-y-2.5">
            <p className="type-eyebrow text-fg-subtle">PEOPLE / MEMBER</p>
            <h1 className="break-words text-[26px] font-semibold leading-tight tracking-tight text-fg">
              {profile.displayName}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Mono dim>@{profile.handle}</Mono>
              {profile.isVerifiedMember ? <VerifiedMark /> : null}
              {profile.roles
                .filter((role) => !(profile.isVerifiedMember && role === 'verified'))
                .map((role) => (
                  <RoleBadge key={role} role={role} size="sm" />
                ))}
            </div>
            {profile.headline ? (
              <p className="max-w-2xl text-body text-fg-muted">{profile.headline}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={`/p/${profile.handle}`} className={buttonStyles({ variant: 'secondary' })}>
            Public profile
            <Icon icon={ExternalLink} size="sm" />
          </Link>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <dt className="type-eyebrow text-fg-subtle">GUILD</dt>
          <dd className="mt-1.5">
            <StatusBadge
              quiet={profile.guildStatus === 'present'}
              tone={GUILD_STATUS_TONE[profile.guildStatus]}
              label={GUILD_STATUS_LABELS[profile.guildStatus].toUpperCase()}
            />
          </dd>
        </div>
        {profile.standing ? (
          <div>
            <dt className="type-eyebrow text-fg-subtle">STANDING</dt>
            <dd className="mt-1.5">
              <StatusBadge
                quiet={profile.standing === 'good'}
                tone={STANDING_TONE[profile.standing]}
                label={STANDING_LABELS[profile.standing].toUpperCase()}
              />
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="type-eyebrow text-fg-subtle">JOINED</dt>
          <dd className="mt-1.5">
            <Mono>{profile.joinedAt ? formatDate(profile.joinedAt, tz) : '—'}</Mono>
          </dd>
        </div>
        <div>
          <dt className="type-eyebrow text-fg-subtle">VISIBILITY</dt>
          <dd className="mt-1.5 text-small text-fg-muted">
            {VISIBILITY_LABELS[profile.profileVisibility]}
          </dd>
        </div>
        <div>
          <dt className="type-eyebrow text-fg-subtle">DISCORD ID</dt>
          <dd className="mt-1.5">
            <Mono className="select-all">{profile.discordId}</Mono>
          </dd>
        </div>
      </dl>

      <StatStrip stats={profile.stats} />

      <div className="space-y-6">
        <LinkTabs
          label="Member sections"
          linkComponent={NextLink}
          tabs={tabs.map((key) => ({
            href:
              key === 'capability'
                ? `/members/${profile.memberId}`
                : `/members/${profile.memberId}?tab=${key}`,
            label: TAB_LABELS[key],
            active: key === tab,
          }))}
        />
        <TabPanel
          tab={tab}
          ctx={ctx}
          profile={profile}
          permissions={permissions}
          catalog={catalog}
          facetLabels={facetLabels}
          timeZone={tz}
        />
      </div>
    </div>
  );
}

interface TabPanelProps {
  tab: Tab;
  ctx: UserContext;
  profile: ProfileView;
  permissions: Permissions;
  catalog: Awaited<ReturnType<typeof loadCatalog>>;
  facetLabels: Record<string, string>;
  timeZone: string;
}

async function TabPanel({
  tab,
  ctx,
  profile,
  permissions,
  catalog,
  facetLabels,
  timeZone,
}: TabPanelProps) {
  const memberId = profile.memberId;
  switch (tab) {
    case 'capability': {
      let evaluator: EvaluatorContext | null = null;
      if (permissions.evaluate) {
        const [rows, evidence] = await Promise.all([
          listMemberCapabilitiesForEvaluator(ctx, memberId),
          listEvidence(ctx, memberId),
        ]);
        evaluator = {
          memberId,
          memberName: profile.displayName,
          tiers: catalog.tiers.map((tier) => tier.code),
          notes: Object.fromEntries(rows.map((row) => [row.facetKey, row.notes])),
          evidence: evidence
            .filter((item) => item.status !== 'rejected')
            .map((item) => ({ id: item.id, title: item.title })),
          setRankAction: setVerifiedRankAction,
          notesAction: setEvaluatorNotesAction,
        };
      }
      return (
        <CapabilityMatrix
          domains={profile.domains}
          facetDescriptions={Object.fromEntries(
            catalog.facets.map((facet) => [facet.key, facet.description]),
          )}
          domainDescriptions={Object.fromEntries(
            catalog.domains.map((domain) => [domain.key, domain.description]),
          )}
          claimsVisible={profile.claimsVisible}
          evaluator={evaluator}
        />
      );
    }
    case 'roles': {
      const grants = await loadRoleGrants(ctx, memberId);
      const rows: RoleRow[] = grants
        ? grants.map((grant) => ({
            role: grant.role,
            description: getRole(grant.role).description,
            provenance: `${formatDate(grant.grantedAt, timeZone)}${grant.grantedByName ? ` · ${grant.grantedByName}` : ''}${grant.expiresAt ? ` · expires ${formatDate(grant.expiresAt, timeZone)}` : ''}`,
            reason: grant.reason,
          }))
        : profile.roles.map((role) => ({
            role,
            description: getRole(role).description,
            provenance: null,
            reason: null,
          }));
      return (
        <RoleManager
          memberId={memberId}
          memberName={profile.displayName}
          roles={rows}
          assignable={profile.isSelf ? [] : assignableRoles(ctx)}
          grantAction={grantRoleAction}
          revokeAction={revokeRoleAction}
        />
      );
    }
    case 'history': {
      const history = await guarded(() => getRankHistory(ctx, memberId));
      if (!history.ok) return <RestrictedState />;
      return <RankHistory entries={history.value} facetLabels={facetLabels} timeZone={timeZone} />;
    }
    case 'evidence': {
      const evidence = await guarded(() => listEvidence(ctx, memberId));
      if (!evidence.ok) return <RestrictedState />;
      return <EvidenceList items={evidence.value} facetLabels={facetLabels} timeZone={timeZone} />;
    }
    case 'notes': {
      const notes = await guarded(() => listMemberNotes(ctx, memberId));
      if (!notes.ok) return <RestrictedState />;
      return (
        <StaffNotes
          memberId={memberId}
          notes={notes.value}
          canAdd={permissions.addNotes}
          addAction={addNoteAction}
          timeZone={timeZone}
        />
      );
    }
    case 'achievements':
      return <AchievementGrid achievements={profile.achievements} timeZone={timeZone} />;
  }
}
