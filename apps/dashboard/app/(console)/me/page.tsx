import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink, UserRoundX } from 'lucide-react';
import {
  getMemberById,
  getMyPreferences,
  getProfile,
  isStaff,
  loadCatalog,
  NOTIFICATION_TYPE_KEYS,
  NOTIFICATION_TYPES,
} from '@jave/core';
import {
  buttonStyles,
  Card,
  EmptyState,
  Icon,
  LinkTabs,
  Mono,
  PageHeader,
  RankBadge,
} from '@jave/ui';
import { ClaimDialog } from '@/components/me/claim-dialog';
import { PreferencesForm } from '@/components/me/preferences-form';
import { ProfileForm } from '@/components/me/profile-form';
import { NextLink } from '@/components/next-link';
import { firstParam, type SearchParams } from '@/lib/search-params';
import { timeZoneOptions } from '@/lib/time';
import { requireConsoleContext, type UserContext } from '@/server/context';
import { claimRankAction, updatePreferencesAction, updateProfileAction } from './actions';

export const metadata: Metadata = { title: 'My profile' };

const TABS = ['profile', 'claims', 'preferences'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  profile: 'Profile',
  claims: 'Claims',
  preferences: 'Preferences',
};

function NoProfile() {
  return (
    <Card padding="none">
      <EmptyState
        icon={UserRoundX}
        title="NO JAVELIN PROFILE"
        description="This account has no member record yet. Join the JAVELIN Discord, then sign in again."
      />
    </Card>
  );
}

async function ProfileTab({ ctx, memberId }: { ctx: UserContext; memberId: string }) {
  const [member, catalog] = await Promise.all([getMemberById(ctx, memberId), loadCatalog(ctx)]);
  return (
    <Card className="max-w-3xl">
      <ProfileForm
        action={updateProfileAction}
        domains={catalog.domains.map((domain) => ({ value: domain.key, label: domain.label }))}
        values={{
          displayName: member.displayName,
          handle: member.handle,
          headline: member.headline ?? '',
          bio: member.bio ?? '',
          primaryDomain: member.primaryDomain ?? '',
          profileVisibility: member.profileVisibility,
          showClaimsPublicly: member.showClaimsPublicly,
          showOnLeaderboards: member.showOnLeaderboards,
        }}
      />
    </Card>
  );
}

async function ClaimsTab({ ctx, memberId }: { ctx: UserContext; memberId: string }) {
  const [profile, catalog] = await Promise.all([getProfile(ctx, { memberId }), loadCatalog(ctx)]);
  const tiers = catalog.tiers.map((tier) => tier.code);
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-small text-fg-subtle">
        Claim where you believe you stand. Claims are labelled CLAIMED everywhere and never change a
        verified rank. Only an evaluator can verify — and nobody can verify themselves.
      </p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {profile.domains.map((domain) => (
          <section
            key={domain.key}
            className="machined relative rounded-lg border border-line bg-surface"
          >
            <header className="flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-3.5">
              <h2 className="type-eyebrow text-fg">{domain.label}</h2>
              <RankBadge
                verifiedRank={domain.verifiedRank}
                claimedRank={domain.claimedRank}
                size="sm"
              />
            </header>
            <ul className="divide-y divide-line-subtle">
              {domain.facets.map((facet) => (
                <li
                  key={facet.facetKey}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-body text-fg">{facet.label}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2">
                      <RankBadge
                        verifiedRank={facet.verifiedRank}
                        claimedRank={facet.claimedRank}
                        size="xs"
                      />
                      {facet.verifiedRank && facet.claimedRank ? (
                        <Mono dim className="text-[11px]">
                          claimed {facet.claimedRank}
                        </Mono>
                      ) : null}
                    </p>
                  </div>
                  <ClaimDialog
                    facetKey={facet.facetKey}
                    facetLabel={facet.label}
                    claimedRank={facet.claimedRank}
                    tiers={tiers}
                    action={claimRankAction}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

async function PreferencesTab({ ctx }: { ctx: UserContext }) {
  const preferences = await getMyPreferences(ctx);
  const staff = isStaff(ctx.actor);
  const dmPreference = new Map(
    preferences.channels
      .filter((row) => row.channel === 'discord_dm')
      .map((row) => [row.type, row.enabled]),
  );
  const types = NOTIFICATION_TYPE_KEYS.filter((type) => {
    const definition = NOTIFICATION_TYPES[type];
    return staff || !('staff' in definition && definition.staff);
  }).map((type) => ({
    type,
    label: NOTIFICATION_TYPES[type].label,
    description: NOTIFICATION_TYPES[type].description,
    enabled: dmPreference.get(type) ?? true,
  }));
  return (
    <Card className="max-w-3xl">
      <PreferencesForm
        action={updatePreferencesAction}
        timeZones={timeZoneOptions()}
        types={types}
        values={{
          timezone: preferences.timezone,
          quietHours: preferences.quietHours,
          dmNotifications: preferences.dmNotifications,
        }}
      />
    </Card>
  );
}

export default async function MePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { ctx, actor } = await requireConsoleContext();
  const requested = firstParam((await searchParams).tab) as Tab | undefined;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'profile';
  const handle = actor.memberId ? (await getMemberById(ctx, actor.memberId)).handle : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="ACCOUNT"
        title="My profile"
        description="How JAVELIN sees you, what you claim, and how JAVE reaches you."
        actions={
          handle ? (
            <Link href={`/p/${handle}`} className={buttonStyles({ variant: 'secondary' })}>
              View public profile
              <Icon icon={ExternalLink} size="sm" />
            </Link>
          ) : null
        }
      />
      <LinkTabs
        label="Account sections"
        linkComponent={NextLink}
        tabs={TABS.map((key) => ({
          href: key === 'profile' ? '/me' : `/me?tab=${key}`,
          label: TAB_LABELS[key],
          active: key === tab,
        }))}
      />
      <div className="max-w-6xl">
        {tab === 'preferences' ? (
          <PreferencesTab ctx={ctx} />
        ) : !actor.memberId ? (
          <NoProfile />
        ) : tab === 'claims' ? (
          <ClaimsTab ctx={ctx} memberId={actor.memberId} />
        ) : (
          <ProfileTab ctx={ctx} memberId={actor.memberId} />
        )}
      </div>
    </div>
  );
}
