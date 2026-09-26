import { describe, expect, it } from 'vitest';
import { type AIHealth, DisabledProvider, MockProvider } from '@jave/ai';
import { probeProvider } from './ai';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const now = () => NOW;
const SHORT_TIMEOUT_MS = 20;
const SECRET = 'sk-live-never-shown';

/** A provider whose health probe the test scripts (TEST ONLY). */
class ScriptedHealthProvider extends MockProvider {
  constructor(private readonly probe: () => Promise<AIHealth>) {
    super();
  }
  override health(): Promise<AIHealth> {
    return this.probe();
  }
}

describe('AI provider status probe', () => {
  it('reports disabled without probing, ok and down from health()', async () => {
    await expect(probeProvider(new DisabledProvider(), now)).resolves.toMatchObject({
      state: 'disabled',
      provider: 'disabled',
    });
    await expect(probeProvider(new MockProvider(), now)).resolves.toMatchObject({
      state: 'ok',
      provider: 'mock',
      checkedAt: NOW,
    });
    const down = new ScriptedHealthProvider(async () => ({ ok: false, detail: 'auth rejected' }));
    await expect(probeProvider(down, now)).resolves.toMatchObject({
      state: 'down',
      detail: 'auth rejected',
    });
  });

  it('BREAK: a hanging probe times out and a throwing one never leaks its message', async () => {
    const hanging = new ScriptedHealthProvider(() => new Promise<AIHealth>(() => undefined));
    await expect(probeProvider(hanging, now, SHORT_TIMEOUT_MS)).resolves.toMatchObject({
      state: 'down',
      detail: 'Health check timed out.',
    });
    const throwing = new ScriptedHealthProvider(() => Promise.reject(new Error(SECRET)));
    const status = await probeProvider(throwing, now);
    expect(status.state).toBe('down');
    expect(JSON.stringify(status)).not.toContain(SECRET);
  });
});
