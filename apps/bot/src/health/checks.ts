import { and, gte, inArray, sql } from 'drizzle-orm';
import { pingDatabase, webhookDeliveries } from '@jave/database';
import { getQueueStats, type HealthCheck, type Worker } from '@jave/core';
import type { Database } from '@jave/database';
import type { Clock } from '@jave/core';
import type { DiscordGateway } from '../discord/gateway';

/** A queue that has not been drained for this long is considered stuck. */
export const QUEUE_STALL_SECONDS = 300;
const DAY_MS = 86_400_000;

export interface HealthDeps {
  db: Database;
  clock: Clock;
  gateway: DiscordGateway;
  worker: Pick<Worker, 'status'> | null;
  pollMs: number;
  extra?: HealthCheck[];
}

export function botHealthChecks(deps: HealthDeps): HealthCheck[] {
  return [
    {
      name: 'discord',
      critical: true,
      run: async () => {
        const status = deps.gateway.status();
        return status.ready
          ? { status: 'ok', detail: status.pingMs !== null ? `${status.pingMs} ms` : undefined }
          : { status: 'down', detail: 'gateway not connected' };
      },
    },
    {
      name: 'database',
      critical: true,
      run: async () => ({ status: 'ok', detail: `${await pingDatabase(deps.db)} ms` }),
    },
    {
      name: 'queue',
      critical: false,
      run: async () => {
        const stats = await getQueueStats(deps.db, deps.clock.now());
        const worker = deps.worker?.status();
        const lastTick = worker?.lastTickAt
          ? deps.clock.now().getTime() - worker.lastTickAt.getTime()
          : null;
        const stalled =
          (stats.oldestPendingSeconds ?? 0) > QUEUE_STALL_SECONDS ||
          (lastTick !== null && lastTick > deps.pollMs * 30);
        const detail = `${stats.pending} pending · ${stats.running} running · ${stats.dead} dead`;
        if (!worker?.running) return { status: 'down', detail: `worker stopped · ${detail}` };
        return { status: stalled || stats.dead > 0 ? 'degraded' : 'ok', detail };
      },
    },
    {
      name: 'webhooks',
      critical: false,
      run: async () => {
        const since = new Date(deps.clock.now().getTime() - DAY_MS);
        const [row] = await deps.db
          .select({ failed: sql<number>`count(*)::int` })
          .from(webhookDeliveries)
          .where(
            and(
              gte(webhookDeliveries.receivedAt, since),
              inArray(webhookDeliveries.status, ['failed', 'dead']),
            ),
          );
        const failed = row?.failed ?? 0;
        return { status: failed > 0 ? 'degraded' : 'ok', detail: `${failed} failed (24h)` };
      },
    },
    ...(deps.extra ?? []),
  ];
}
