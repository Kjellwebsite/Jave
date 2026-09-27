import { useState } from 'react';
import {
  Avatar,
  cx,
  describeRank,
  Emblem,
  formatCount,
  isRoleKey,
  RankBadge,
  RoleBadge,
} from '@jave/ui';
import type { DomainRankWire, ProfileStatsWire, ProfileWire } from '../../api/contract';
import { VerifiedMark } from '../../components/verified-mark';

const STATS: readonly { key: keyof ProfileStatsWire; label: string }[] = [
  { key: 'trials', label: 'TRIALS' },
  { key: 'trialsPassed', label: 'PASSED' },
  { key: 'projectsShipped', label: 'SHIPPED' },
  { key: 'missionsCompleted', label: 'MISSIONS' },
  { key: 'achievements', label: 'ACHIEVEMENTS' },
];
/** Stats wrap 3 + 2 on phones (a six-column track, spans 2 and 3), as on the public profile. */
const MOBILE_FIRST_ROW = 3;

/** The domain opened first: the member's primary domain, else the first with any data. */
function initialDomain(profile: ProfileWire): string | null {
  const primary = profile.domains.find((domain) => domain.key === profile.primaryDomain);
  const informed = profile.domains.find((domain) => domain.status !== 'unknown');
  return (primary ?? informed ?? profile.domains[0])?.key ?? null;
}

function DomainButton({
  domain,
  selected,
  onSelect,
}: {
  domain: DomainRankWire;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${domain.label}: ${describeRank(domain).ariaLabel}`}
      onClick={onSelect}
      className={cx(
        'relative flex min-w-0 flex-col items-center gap-2.5 px-1 py-4 transition-colors sm:py-5',
        selected ? 'bg-surface-raised' : 'hover:bg-surface-raised/60',
      )}
    >
      <span className="type-eyebrow text-[10px] text-fg-subtle">{domain.label}</span>
      <RankBadge
        verifiedRank={domain.verifiedRank}
        claimedRank={domain.claimedRank}
        size="lg"
        label="none"
      />
      <span
        className={cx(
          'type-eyebrow text-[9px]',
          domain.status === 'verified' ? 'text-fg' : 'text-fg-subtle',
        )}
      >
        {domain.status.toUpperCase()}
      </span>
      {selected ? (
        <span aria-hidden className="absolute inset-x-3 bottom-0 h-px bg-fg" />
      ) : null}
    </button>
  );
}

function FacetList({ domain }: { domain: DomainRankWire }) {
  return (
    <div className="px-5 py-4">
      <p className="type-eyebrow text-fg-subtle">{domain.label} · FACETS</p>
      <ul className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {domain.facets.map((facet) => {
          const differs =
            facet.verifiedRank !== null &&
            facet.claimedRank !== null &&
            facet.claimedRank !== facet.verifiedRank;
          return (
            <li key={facet.key} className="flex min-w-0 items-center justify-between gap-3">
              <span className="truncate text-small text-fg-muted">{facet.label}</span>
              <span className="flex shrink-0 items-center gap-2.5">
                {differs ? (
                  <span className="type-data text-[11px] text-fg-subtle">
                    claimed {facet.claimedRank}
                  </span>
                ) : null}
                <span
                  className={cx(
                    'type-eyebrow text-[9px]',
                    facet.status === 'verified' ? 'text-fg-muted' : 'text-fg-subtle',
                  )}
                >
                  {facet.status.toUpperCase()}
                </span>
                <RankBadge
                  verifiedRank={facet.verifiedRank}
                  claimedRank={facet.claimedRank}
                  size="sm"
                  label="none"
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** JVLN PROFILE: identity, peak rank per domain (never a total), facets and record. */
export function ProfileCard({ profile }: { profile: ProfileWire }) {
  const [selected, setSelected] = useState<string | null>(() => initialDomain(profile));
  const domain = profile.domains.find((entry) => entry.key === selected) ?? null;
  const role = profile.primaryRole && isRoleKey(profile.primaryRole) ? profile.primaryRole : null;

  return (
    <article
      aria-labelledby="mc-profile-name"
      className="machined relative flex flex-col rounded-lg border border-line bg-surface"
    >
      <section className="relative overflow-hidden rounded-t-lg px-5 pb-5 pt-4">
        <Emblem
          size={150}
          variant="mono"
          className="pointer-events-none absolute -right-6 -top-4 text-fg opacity-[0.035]"
        />
        <div className="flex items-center justify-between gap-4">
          <p className="type-eyebrow text-fg-subtle">JVLN PROFILE</p>
          <p className="type-data truncate text-[11px] text-fg-subtle">@{profile.handle}</p>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <Avatar name={profile.displayName} size="xl" className="rounded-lg" />
          <div className="min-w-0 space-y-2">
            <h2
              id="mc-profile-name"
              className="break-words font-display text-[20px] font-semibold uppercase leading-[1.1] tracking-[0.1em] text-fg sm:text-[24px]"
            >
              {profile.displayName}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {profile.isVerifiedMember ? <VerifiedMark /> : null}
              {role && !(profile.isVerifiedMember && role === 'verified') ? (
                <RoleBadge role={role} size="sm" />
              ) : null}
            </div>
          </div>
        </div>
        {profile.headline ? (
          <p className="mt-3 line-clamp-2 text-small text-fg-muted">{profile.headline}</p>
        ) : null}
      </section>

      <section aria-label="Capability by domain" className="border-t border-line-subtle">
        <div
          className="grid divide-x divide-line-subtle"
          style={{ gridTemplateColumns: `repeat(${profile.domains.length}, minmax(0, 1fr))` }}
        >
          {profile.domains.map((entry) => (
            <DomainButton
              key={entry.key}
              domain={entry}
              selected={entry.key === selected}
              onSelect={() => setSelected(entry.key)}
            />
          ))}
        </div>
        {domain ? (
          <div className="border-t border-line-subtle">
            <FacetList domain={domain} />
          </div>
        ) : null}
      </section>

      <section aria-label="Record" className="overflow-hidden border-t border-line-subtle">
        <dl className="-mb-px -mr-px grid grid-cols-6 sm:grid-cols-5">
          {STATS.map(({ key, label }, index) => (
            <div
              key={key}
              className={cx(
                'flex flex-col-reverse items-center gap-2 border-b border-r border-line-subtle px-1 py-4 sm:col-span-1',
                index < MOBILE_FIRST_ROW ? 'col-span-2' : 'col-span-3',
              )}
            >
              <dt className="type-eyebrow text-[9px] text-fg-subtle">{label}</dt>
              <dd
                className={cx(
                  'font-display text-[22px] font-medium leading-none tabular-nums',
                  profile.stats[key] === 0 ? 'text-fg-subtle' : 'text-fg',
                )}
              >
                {formatCount(profile.stats[key])}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="mt-auto rounded-b-lg border-t border-line-subtle bg-surface-sunken px-5 py-3">
        <p className="text-[12px] leading-snug text-fg-subtle">
          VERIFIED ranks are set by evaluators. CLAIMED ranks are self-reported. There is no total
          score.
        </p>
      </footer>
    </article>
  );
}
