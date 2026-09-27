import { useEffect, useState } from 'react';
import { Emblem, Tabs, TabsContent, TabsList, TabsTrigger, Wordmark } from '@jave/ui';
import type { ActivitySession } from '../api/session';
import { LiveIndicator } from '../components/live-indicator';
import { useArena } from '../hooks/use-arena';
import { isLive } from '../lib/arena';
import type { AuthSession } from '../platform/hosts';
import { ArenaView } from '../views/arena/arena-view';
import { MissionControlView } from '../views/mission-control/mission-control-view';

type Tab = 'mission' | 'arena';

/** Tabs sit flush with the content edge; the underline spans the label only. */
const TAB_TRIGGER = 'px-0!';

function isTab(value: string): value is Tab {
  return value === 'mission' || value === 'arena';
}

/**
 * The signed-in Activity: a brand bar, two views and the Arena link state.
 * Both views stay mounted, so switching is instant and nothing reloads.
 * On launch the Arena opens first when a game is already live here.
 */
export function Console({ session, auth }: { session: ActivitySession; auth: AuthSession }) {
  const arena = useArena(session);
  const [tab, setTab] = useState<Tab | null>(null);

  useEffect(() => {
    if (tab === null && arena.response) {
      setTab(isLive(arena.response.session) ? 'arena' : 'mission');
    }
  }, [tab, arena.response]);

  const current: Tab = tab ?? 'mission';
  const arenaCallsYou = isLive(arena.session) && current !== 'arena';

  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        if (isTab(value)) setTab(value);
      }}
      className="flex flex-1 flex-col"
    >
      <header className="sticky top-0 z-30 bg-canvas">
        <div className="mx-auto flex h-12 w-full max-w-[1280px] items-center gap-3 px-4 sm:px-6">
          <span className="flex items-center gap-2.5" aria-label="JAVELIN">
            <Emblem size="sm" />
            <Wordmark size="sm" />
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <LiveIndicator connection={arena.connection} />
            <span
              className="hidden max-w-48 truncate text-small text-fg-muted sm:inline"
              data-testid="signed-in-as"
            >
              {auth.displayName}
            </span>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6">
          <TabsList aria-label="Views" className="gap-6 overflow-visible!">
            <TabsTrigger value="mission" className={TAB_TRIGGER}>
              MISSION CONTROL
            </TabsTrigger>
            <TabsTrigger value="arena" className={TAB_TRIGGER}>
              JVLN ARENA
              {arenaCallsYou ? (
                <span aria-label="live game" className="size-1.5 rounded-full bg-success" />
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-10 sm:px-6">
        <TabsContent value="mission" forceMount className="pt-5 data-[state=inactive]:hidden">
          <MissionControlView session={session} />
        </TabsContent>
        <TabsContent value="arena" forceMount className="pt-5 data-[state=inactive]:hidden">
          <ArenaView arena={arena} clock={session.clock} active={current === 'arena'} />
        </TabsContent>
      </main>
    </Tabs>
  );
}
