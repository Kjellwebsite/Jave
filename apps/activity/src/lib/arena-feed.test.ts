import { describe, expect, it } from 'vitest';
import type { ArenaResponse, ArenaSessionWire } from '../api/contract';
import { ArenaFeed } from './arena-feed';

function session(id: string, status: ArenaSessionWire['status'], version = 1): ArenaSessionWire {
  return {
    id,
    status,
    version,
    gameName: 'TRIVIA',
    isHost: true,
    youArePlayer: true,
    canStart: false,
    canClose: false,
    canJoin: false,
    practice: false,
    minPlayers: 1,
    maxPlayers: 25,
    config: { rounds: 5, secondsPerQuestion: 10, difficulty: 'mixed' },
    players: [],
    trivia: null,
    endReason: null,
  };
}

function response(current: ArenaSessionWire | null, liveSessionId: string | null): ArenaResponse {
  return { serverNow: 1, session: current, liveSessionId, canHost: true, difficulties: [] };
}

describe('ArenaFeed', () => {
  it('BREAK: a poll sent before "Open new lobby" never switches back to the finished game', () => {
    const feed = new ArenaFeed();
    feed.pollResult(feed.stamp(), response(session('done', 'completed'), null));
    expect(feed.following).toBe('done');

    const inFlight = feed.stamp(); // GET ?sessionId=done leaves…
    const lobby = response(session('next', 'lobby'), 'next');
    feed.actionResult(lobby); // …the POST opening the next lobby answers first…
    const late = response(session('done', 'completed'), 'next');
    expect(feed.pollResult(inFlight, late)).toBeNull(); // …and the stale GET is dropped.

    expect(feed.latest!.session!.id).toBe('next');
    expect(feed.following).toBe('next');
    // Polls sent after the action are applied as usual.
    const joined = response(session('next', 'lobby', 2), 'next');
    expect(feed.pollResult(feed.stamp(), joined)!.session!.version).toBe(2);
  });

  it('BREAK: a poll that saw nothing live never replaces the lobby just opened', () => {
    const feed = new ArenaFeed();
    feed.pollResult(feed.stamp(), response(null, null));
    const inFlight = feed.stamp();
    feed.actionResult(response(session('fresh', 'lobby'), 'fresh'));
    expect(feed.pollResult(inFlight, response(null, null))).toBeNull();
    expect(feed.latest!.session!.id).toBe('fresh');
  });

  it('BREAK: a 404 from a stale poll does not unfollow the session an action switched to', () => {
    const feed = new ArenaFeed();
    feed.pollResult(feed.stamp(), response(session('gone', 'abandoned'), null));
    const inFlight = feed.stamp();
    feed.actionResult(response(session('new', 'lobby'), 'new'));
    feed.pollFailed(inFlight, 404);
    expect(feed.following).toBe('new');
    // A current poll that finds the followed session gone falls back to the live one.
    feed.pollFailed(feed.stamp(), 404);
    expect(feed.following).toBeNull();
  });

  it('keeps the newer version of the same session whichever stream delivers it', () => {
    const feed = new ArenaFeed();
    const stamp = feed.stamp();
    feed.pollResult(stamp, response(session('s', 'active', 3), 's'));
    // A poll that answers before the action applies is still current.
    expect(feed.pollResult(feed.stamp(), response(session('s', 'active', 2), 's'))).not.toBeNull();
    expect(feed.latest!.session!.version).toBe(3);
    feed.actionResult(response(session('s', 'active', 5), 's'));
    expect(feed.latest!.session!.version).toBe(5);
    feed.actionResult(response(session('s', 'active', 4), 's'));
    expect(feed.latest!.session!.version).toBe(5);
  });
});
