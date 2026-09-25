import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { planFor } from '../src/engine/batteries';
import { createSession } from '../src/engine/session';
import { registerAll } from '../src/items';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

beforeAll(() => registerAll());
beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe('storage', () => {
  it('round-trips sessions and tracks the active one', async () => {
    const { saveSession, loadSession, activeSessionId, listSessions } = await import('../src/data/storage');
    const s = createSession({ mode: 'quick', plan: planFor('quick'), device: { input: 'mouse', viewport: 'large', reducedMotion: false, browser: 't' }, now: 1, seed: 5 });
    expect(saveSession(s)).toBe(true);
    expect(loadSession(s.id)?.id).toBe(s.id);
    expect(activeSessionId()).toBe(s.id);
    expect(listSessions()).toHaveLength(1);
  });

  it('rejects corrupted or foreign data instead of crashing', async () => {
    const { loadSession, listSessions } = await import('../src/data/storage');
    localStorage.setItem('jvln.v1.bad', '{not json');
    localStorage.setItem('jvln.v1.foreign', JSON.stringify({ hello: 'world' }));
    localStorage.setItem('jvln.v1.sessions', '"garbage"');
    expect(loadSession('bad')).toBeNull();
    expect(loadSession('foreign')).toBeNull();
    expect(listSessions()).toEqual([]);
  });

  it('survives storage that throws', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    const { saveSession, loadSession } = await import('../src/data/storage');
    const s = createSession({ mode: 'quick', plan: planFor('quick'), device: { input: 'mouse', viewport: 'large', reducedMotion: false, browser: 't' }, now: 1, seed: 6 });
    expect(saveSession(s)).toBe(false);
    expect(loadSession(s.id)).toBeNull();
  });
});
