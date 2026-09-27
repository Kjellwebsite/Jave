import type { calendar, DomainSummary, missions, ProfileView, trials } from '@jave/core';
import type { DomainRankWire, EventWire, MissionWire, ProfileWire, TrialWire } from '../contract';

/**
 * Whitelist mappers from core views to the Activity wire format. Fields are
 * copied one by one: nothing new that core adds to a view (staff-only data,
 * internal ids) can reach the Activity without a deliberate change here.
 */

const MAX_LOCATION_LABEL = 80;

const epoch = (date: Date | null): number | null => (date ? date.getTime() : null);

function toDomain(domain: DomainSummary): DomainRankWire {
  return {
    key: domain.key,
    label: domain.label,
    verifiedRank: domain.verifiedRank,
    claimedRank: domain.claimedRank,
    status: domain.status,
    facets: domain.facets.map((facet) => ({
      key: facet.facetKey,
      label: facet.label,
      verifiedRank: facet.verifiedRank,
      claimedRank: facet.claimedRank,
      status: facet.status,
    })),
  };
}

export function toProfileWire(profile: ProfileView): ProfileWire {
  return {
    displayName: profile.displayName,
    handle: profile.handle,
    headline: profile.headline,
    primaryRole: profile.primaryRole,
    isVerifiedMember: profile.isVerifiedMember,
    primaryDomain: profile.primaryDomain,
    domains: profile.domains.map(toDomain),
    stats: {
      trials: profile.stats.trials,
      trialsPassed: profile.stats.trialsPassed,
      projects: profile.stats.projects,
      projectsShipped: profile.stats.projectsShipped,
      contributions: profile.stats.contributions,
      missionsCompleted: profile.stats.missionsCompleted,
      achievements: profile.stats.achievements,
    },
  };
}

export function toMissionWire(item: missions.MyMissionItem): MissionWire {
  return {
    assignmentId: item.assignment.id,
    number: item.mission.number,
    title: item.mission.title,
    type: item.mission.type,
    status: item.assignment.status,
    dueAt: epoch(item.assignment.dueAt ?? item.mission.deadlineAt),
  };
}

/** Running trials first, then the next one scheduled; only trials the member competes in. */
const TRIAL_PRIORITY: Record<string, number> = { active: 0, teams_assigned: 1 };

/**
 * The member's current trial from their own history (member-safe summaries:
 * no adversarial flag, no staff fields). Never reads the adversarial module.
 */
export function pickCurrentTrial(entries: readonly trials.TrialHistoryEntry[]): TrialWire | null {
  const candidates = entries
    .filter(
      (entry) => entry.status === 'selected' && Object.hasOwn(TRIAL_PRIORITY, entry.trial.status),
    )
    .sort(
      (a, b) =>
        TRIAL_PRIORITY[a.trial.status]! - TRIAL_PRIORITY[b.trial.status]! ||
        (a.trial.deadlineAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (b.trial.deadlineAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    );
  const entry = candidates[0];
  if (!entry) return null;
  const { trial } = entry;
  return {
    ref: trial.ref,
    title: trial.title,
    category: trial.category,
    status: trial.status,
    phase: trial.timing.phase,
    scheduledStartAt: epoch(trial.scheduledStartAt),
    startedAt: epoch(trial.startedAt),
    deadlineAt: epoch(trial.timing.deadlineAt),
    closesAt: epoch(trial.timing.closesAt),
    teamName: entry.teamName,
  };
}

function locationLabel(location: calendar.EventView['location']): EventWire['location'] {
  if (!location) return null;
  switch (location.kind) {
    case 'channel':
      return { kind: 'channel', label: 'Discord channel' };
    case 'url': {
      let host = 'Online';
      try {
        host = new URL(location.value).hostname;
      } catch {
        // classifyLocation only lets parseable http(s) URLs through; keep the generic label.
      }
      return { kind: 'url', label: host.slice(0, MAX_LOCATION_LABEL) };
    }
    case 'text':
      return { kind: 'text', label: location.value.slice(0, MAX_LOCATION_LABEL) };
  }
}

export function toEventWire(event: calendar.EventView): EventWire {
  return {
    id: event.id,
    title: event.title,
    kind: event.kind,
    status: event.status,
    startsAt: event.startsAt.getTime(),
    endsAt: event.endsAt.getTime(),
    location: locationLabel(event.location),
    myRsvp: event.myRsvp?.status ?? null,
  };
}
