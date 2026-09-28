import { RotateCcw, UserRound } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@jave/ui';
import type { ActivitySession } from '../../api/session';
import { useMissionControl } from '../../hooks/use-mission-control';
import { useServerNow } from '../../hooks/use-server-now';
import { EventsPanel } from './events-panel';
import { MissionsPanel } from './missions-panel';
import { ProfileCard } from './profile-card';
import { TrialPanel } from './trial-panel';

/** Countdowns tick once a second. */
const COUNTDOWN_TICK_MS = 1_000;

function MissionControlSkeleton() {
  return (
    <div role="status" aria-live="polite" className="grid gap-4 lg:grid-cols-12">
      <span className="sr-only">Loading Mission Control</span>
      <Card className="space-y-5 lg:col-span-5">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-16 w-full" />
      </Card>
      <div className="space-y-4 lg:col-span-7">
        <Card className="space-y-3">
          <Skeleton className="h-3 w-1/4" />
          <Skeleton className="h-8 w-1/3" />
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-3">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Card>
          <Card className="space-y-3">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-10 w-full" />
          </Card>
        </div>
      </div>
    </div>
  );
}

/** MISSION CONTROL — the member's own profile, ranks, missions, trial and events. */
export function MissionControlView({ session }: { session: ActivitySession }) {
  const { data, error, loading, refresh } = useMissionControl(session);
  const now = useServerNow(session.clock, COUNTDOWN_TICK_MS);

  if (!data) {
    if (error && !loading) {
      return (
        <ErrorState
          title="MISSION CONTROL UNAVAILABLE"
          description={
            error.transient
              ? 'JAVELIN could not be reached. The view retries on its own.'
              : error.message
          }
          reference={error.reference}
          action={
            <Button variant="secondary" iconLeft={RotateCcw} onClick={refresh}>
              Try again
            </Button>
          }
        />
      );
    }
    return <MissionControlSkeleton />;
  }

  const profile = (
    <div key="profile" className="lg:col-span-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
      {data.profile ? (
        <ProfileCard profile={data.profile} />
      ) : (
        <Card>
          <EmptyState
            icon={UserRound}
            title="NO JVLN PROFILE YET"
            description="Your JAVELIN profile appears once you have joined the server."
          />
        </Card>
      )}
    </div>
  );
  const trial = (
    <div key="trial" className="lg:col-span-7 lg:col-start-6 lg:row-start-1">
      <TrialPanel trial={data.trial} now={now} />
    </div>
  );
  const lists = (
    <div
      key="lists"
      className="grid items-start gap-4 md:grid-cols-2 lg:col-span-7 lg:col-start-6 lg:row-start-2"
    >
      <MissionsPanel missions={data.missions} total={data.missionsTotal} now={now} />
      <EventsPanel events={data.events} now={now} />
    </div>
  );
  // Wide screens place the three blocks explicitly. On a phone a running trial's
  // countdown is the most urgent fact, so it comes first (in reading order too).
  const order = data.trial ? [trial, profile, lists] : [profile, trial, lists];
  return (
    <div
      className="grid items-start gap-4 lg:grid-cols-12 lg:grid-rows-[auto_1fr]"
      data-testid="mission-control"
    >
      {order}
    </div>
  );
}
