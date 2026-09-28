import type { ArenaResponse } from '../api/contract';
import { newerResponse } from './arena';

const HTTP_NOT_FOUND = 404;

/**
 * The Arena state as this viewer sees it, fed by two unordered streams:
 * polls (every second) and actions (open, join, start, answer…).
 *
 * Within one session the higher `version` wins (`newerResponse`). Across
 * sessions there is no version to compare, and an action can switch the
 * followed session ("Open new lobby", "Join next lobby"). A poll sent before
 * an action's result was applied describes the world before that action, so
 * it is dropped instead of switching the view back to the old session.
 */
export class ArenaFeed {
  private current: ArenaResponse | null = null;
  private followed: string | null = null;
  /** Bumped whenever an action's result is applied; polls carry the value they were sent under. */
  private generation = 0;

  get latest(): ArenaResponse | null {
    return this.current;
  }

  /** The session this viewer follows; null follows whatever is live in the instance. */
  get following(): string | null {
    return this.followed;
  }

  /** Taken just before a poll is sent. */
  stamp(): number {
    return this.generation;
  }

  /** An action answered: always applied, and every poll still in flight becomes stale. */
  actionResult(next: ArenaResponse): ArenaResponse {
    this.generation += 1;
    return this.apply(next);
  }

  /** A poll answered. Returns the view to render, or null when the poll raced an action and lost. */
  pollResult(stamp: number, next: ArenaResponse): ArenaResponse | null {
    if (stamp !== this.generation) return null;
    return this.apply(next);
  }

  /**
   * A poll failed. When the followed session is gone (or out of scope), fall
   * back to the instance's live session, unless an action moved on meanwhile.
   */
  pollFailed(stamp: number, status: number | null): void {
    if (stamp === this.generation && status === HTTP_NOT_FOUND) this.followed = null;
  }

  private apply(next: ArenaResponse): ArenaResponse {
    const merged = newerResponse(this.current, next);
    this.current = merged;
    this.followed = merged.session?.id ?? null;
    return merged;
  }
}
