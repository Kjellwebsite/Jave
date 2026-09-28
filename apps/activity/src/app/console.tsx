import { useEffect, useState } from 'react';
import { Emblem, Tabs, TabsContent, TabsList, TabsTrigger, Wordmark } from '@jave/ui';
import type { ActivitySession } from '../api/session';
import { LiveIndicator } from '../components/live-indicator';
import { useArena } from '../hooks/use-arena';
import { useArenaBoard } from '../hooks/use-arena-board';
import { boardRefreshKey, isLive } from '../lib/arena';
import type { AuthSession } from '../platform/hosts';
import { ArenaView } from '../views/arena/arena-view';
import { MissionControlView } from '../views/mission-control/mission-control-view';

type Tab = 'mission' | 'arena';

/**
 * Tabs sit flush with the content edge; on wide screens they share the bar
 * with the brand, and the active underline lands on the bar's bottom rule.
 */
const TAB_TRIGGER = 'px-0! md:h-14';
const VIEW = 'flex-1 flex-col data-[state=active]:flex data-[state=inactive]:hidden';

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
  const board = useArenaBoard(session, boardRefreshKey(arena.session));
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
      <header className="sticky top-0 z-30 border-b border-line bg-canvas">
        <div className="mx-auto grid w-full max-w-[1280px] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-8 px-4 sm:px-6 md:grid-cols-[auto_auto_minmax(0,1fr)]">
          <span
            className="col-start-1 row-start-1 flex h-12 items-center gap-2.5 md:h-14"
            aria-label="JAVELIN"
          >
            <Emblem size="sm" />
            <Wordmark size="sm" />
          </span>
          <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-3 md:col-start-3">
            <LiveIndicator connection={arena.connection} />
            <span
              className="hidden max-w-48 truncate text-small text-fg-muted sm:inline"
              data-testid="signed-in-as"
            >
              {auth.displayName}
            </span>
          </div>
          <TabsList
            aria-label="Views"
            className="col-span-2 row-start-2 gap-6 overflow-visible! border-b-0! md:col-span-1 md:col-start-2 md:row-start-1 md:self-end"
          >
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

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col px-4 pb-10 sm:px-6">
        <TabsContent value="mission" forceMount className={VIEW}>
          <MissionControlView session={session} />
        </TabsContent>
        <TabsContent value="arena" forceMount className={VIEW}>
          <ArenaView
            arena={arena}
            board={board}
            clock={session.clock}
            active={current === 'arena'}
          />
        </TabsContent>
      </main>
    </Tabs>
  );
}
