import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { silentLogger } from '@jave/core';
import { createBotHarness, type BotHarness } from '../testing/harness';
import { startHealthServer } from './server';

describe('health server', () => {
  let bot: BotHarness;
  let server: Server;
  let port = 0;
  beforeEach(async () => {
    port = 18000 + Math.floor(Math.random() * 2000);
    bot = await createBotHarness();
    server = startHealthServer({
      port,
      logger: silentLogger,
      report: () => bot.app.services.health(),
    });
    await new Promise((r) => server.once('listening', r));
  });
  afterEach(async () => {
    server.closeAllConnections();
    server.close();
    await bot.close();
  });

  it('liveness is independent of dependencies; readiness reflects them', async () => {
    bot.app.worker.start();
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(ready.status).toBe(200);
    const body = (await ready.json()) as { checks: { name: string }[] };
    expect(body.checks.map((c) => c.name)).toEqual(['discord', 'database', 'queue', 'webhooks']);
    bot.gateway.ready = false;
    expect((await fetch(`http://127.0.0.1:${port}/readyz`)).status).toBe(503);
    await bot.app.worker.stop();
  });

  it('rejects other methods and paths', async () => {
    expect((await fetch(`http://127.0.0.1:${port}/healthz`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${port}/admin`)).status).toBe(404);
  });
});
