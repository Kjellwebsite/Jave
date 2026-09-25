import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { Award } from 'lucide-react';
import { type DomainSummary, getProfile, HANDLE_PATTERN, type ProfileView } from '@jave/core';
import { Avatar, cx, Emblem, formatCount, Icon, RankBadge, RoleBadge, Wordmark } from '@jave/ui';
import { VerifiedMark } from '@/components/members/verified-mark';
import { formatDate } from '@/lib/time';
import { getRequestContext } from '@/server/context';
import { guarded } from '@/server/guard';
import { getRuntime } from '@/server/runtime';

const SHOWCASE_ACHIEVEMENTS = 6;
const MAX_DESCRIPTION_LENGTH = 200;
/** Stats wrap 3 + 2 on phones (a six-column track, spans 2 and 3). */
const MOBILE_FIRST_ROW = 3;

/**
 * One privacy-checked load per request, shared by metadata and page.
 * Deliberately no loading.tsx here: without a streaming boundary a hidden or
 * unknown handle returns a real HTTP 404 (both look identical to the visitor).
 */
const loadPublicProfile = cache(async (handle: string): Promise<ProfileView | null> => {
  const normalized = handle.toLowerCase();
  if (!HANDLE_PATTERN.test(normalized)) return null;
  const { ctx } = await getRequestContext();
  const result = await guarded(() => getProfile(ctx, { handle: normalized }));
  return result.ok ? result.value : null;
});

/** "MIND S · CREATE A" — verified ranks only; claims never appear in shared previews. */
function verifiedSummary(domains: readonly DomainSummary[]): string {
  return domains
    .filter((domain) => domain.verifiedRank)
    .map((domain) => `${domain.label.toUpperCase()} ${domain.verifiedRank}`)
    .join(' · ');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const profile = await loadPublicProfile((await params).handle);
  if (!profile) return { title: 'Profile not found', robots: { index: false, follow: false } };
  const title = `${profile.displayName} — JVLN PROFILE`;
  const summary = verifiedSummary(profile.domains);
  const description = [
    profile.isVerifiedMember ? 'VERIFIED' : null,
    summary || null,
    profile.headline,
  ]
    .filter(Boolean)
    .join(' · ')
    .slice(0, MAX_DESCRIPTION_LENGTH);
  const url = new URL(`/p/${profile.handle}`, getRuntime().env.JAVE_PUBLIC_URL).toString();
  return {
    title: { absolute: title },
    description: description || 'A JAVELIN member profile.',
    alternates: { canonical: url },
    robots: { index: profile.profileVisibility === 'public', follow: false },
    openGraph: {
      type: 'profile',
      title,
      description: description || 'A JAVELIN member profile.',
      url,
      siteName: 'JAVELIN',
      username: profile.handle,
    },
    twitter: { card: 'summary', title, description: description || undefined },
  };
}

function DomainCell({ domain }: { domain: DomainSummary }) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-6 sm:py-8">
      <span className="type-eyebrow text-[10px] text-fg-subtle sm:text-micro">{domain.label}</span>
      <span className="sm:hidden">
        <RankBadge
          verifiedRank={domain.verifiedRank}
          claimedRank={domain.claimedRank}
          size="lg"
          label="none"
        />
      </span>
      <span className="hidden sm:block">
        <RankBadge
          verifiedRank={domain.verifiedRank}
          claimedRank={domain.claimedRank}
          size="xl"
          label="none"
        />
      </span>
      <span
        className={cx(
          'type-eyebrow text-[9px] sm:text-[10px]',
          domain.status === 'verified' ? 'text-fg' : 'text-fg-subtle',
        )}
      >
        {domain.status.toUpperCase()}
      </span>
    </div>
  );
}

const STATS: readonly { key: keyof ProfileView['stats']; label: string }[] = [
  { key: 'trials', label: 'TRIALS' },
  { key: 'trialsPassed', label: 'PASSED' },
  { key: 'projects', label: 'PROJECTS' },
  { key: 'contributions', label: 'CONTRIBUTIONS' },
  { key: 'achievements', label: 'ACHIEVEMENTS' },
];

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const profile = await loadPublicProfile((await params).handle);
  if (!profile) notFound();

  return (
    <main className="relative isolate min-h-dvh px-4 pb-16 pt-8 sm:pt-12">
      <div aria-hidden className="blueprint-grid pointer-events-none absolute inset-0 -z-10" />
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex justify-center">
          <Link href="/" className="flex items-center gap-3" aria-label="JAVELIN">
            <Emblem size="sm" />
            <Wordmark size="sm" />
          </Link>
        </header>

        <article
          aria-labelledby="profile-name"
          className="machined corner-ticks relative mt-8 rounded-lg border border-line bg-surface sm:mt-10"
        >
          <section className="relative overflow-hidden rounded-t-lg px-6 pb-8 pt-7 sm:px-10 sm:pb-10 sm:pt-9">
            <Emblem
              size={240}
              variant="mono"
              className="pointer-events-none absolute -right-10 -top-6 text-fg opacity-[0.035] sm:right-4"
            />
            <div className="flex items-center justify-between gap-4">
              <p className="type-eyebrow text-fg-subtle">JVLN PROFILE</p>
              <p className="type-data text-[11px] text-fg-subtle">@{profile.handle}</p>
            </div>
            <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-center">
              <Avatar
                name={profile.displayName}
                src={profile.avatarUrl}
                size="2xl"
                className="rounded-lg"
              />
              <div className="min-w-0 space-y-3.5">
                <h1
                  id="profile-name"
                  className="break-words font-display text-[28px] font-semibold uppercase leading-[1.05] tracking-[0.1em] text-fg sm:text-[40px]"
                >
                  {profile.displayName}
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                  {profile.isVerifiedMember ? <VerifiedMark /> : null}
                  {profile.primaryRole &&
                  !(profile.isVerifiedMember && profile.primaryRole === 'verified') ? (
                    <RoleBadge role={profile.primaryRole} size="sm" />
                  ) : null}
                </div>
                {profile.headline ? (
                  <p className="max-w-xl text-body text-fg-muted">{profile.headline}</p>
                ) : null}
              </div>
            </div>
          </section>

          <section aria-label="Capability by domain" className="border-t border-line-subtle">
            <div
              className="grid divide-x divide-line-subtle"
              style={{ gridTemplateColumns: `repeat(${profile.domains.length}, minmax(0, 1fr))` }}
            >
              {profile.domains.map((domain) => (
                <DomainCell key={domain.key} domain={domain} />
              ))}
            </div>
          </section>

          <section aria-label="Record" className="border-t border-line-subtle">
            <dl className="grid grid-cols-6 sm:grid-cols-5">
              {STATS.map(({ key, label }, index) => (
                <div
                  key={key}
                  className={cx(
                    '-mb-px -mr-px flex flex-col-reverse items-center gap-2.5 border-b border-r border-line-subtle px-2 py-5 sm:col-span-1',
                    index < MOBILE_FIRST_ROW ? 'col-span-2' : 'col-span-3',
                  )}
                >
                  <dt className="type-eyebrow text-[9px] text-fg-subtle sm:text-[10px]">{label}</dt>
                  <dd
                    className={cx(
                      'font-display text-[26px] font-medium leading-none tabular-nums sm:text-[30px]',
                      profile.stats[key] === 0 ? 'text-fg-subtle' : 'text-fg',
                    )}
                  >
                    {formatCount(profile.stats[key])}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {profile.bio || profile.achievements.length > 0 ? (
            <section className="space-y-6 border-t border-line-subtle px-6 py-7 sm:px-10">
              {profile.bio ? (
                <p className="max-w-2xl whitespace-pre-line text-body text-fg-muted">
                  {profile.bio}
                </p>
              ) : null}
              {profile.achievements.length > 0 ? (
                <div>
                  <h2 className="type-eyebrow text-fg-subtle">ACHIEVEMENTS</h2>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {profile.achievements.slice(0, SHOWCASE_ACHIEVEMENTS).map((achievement) => (
                      <li
                        key={achievement.key}
                        className="inline-flex items-center gap-2 rounded-sm border border-line-strong bg-surface-raised px-2.5 py-1.5"
                        title={achievement.description}
                      >
                        <Icon icon={Award} size="sm" className="text-fg-subtle" />
                        <span className="type-eyebrow text-fg">{achievement.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          <footer className="flex flex-col gap-2 rounded-b-lg border-t border-line-subtle bg-surface-sunken px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <p className="text-small text-fg-subtle">
              VERIFIED ranks are set by evaluators. CLAIMED ranks are self-reported. There is no
              total score.
            </p>
            {profile.joinedAt ? (
              <p className="type-data shrink-0 text-[11px] text-fg-subtle">
                SINCE {formatDate(profile.joinedAt)}
              </p>
            ) : null}
          </footer>
        </article>

        <p className="type-data mt-10 text-center text-[11px] text-fg-faint">
          JAVELIN — YOU THINK YOU’RE ELITE? PROVE IT.
        </p>
      </div>
    </main>
  );
}
