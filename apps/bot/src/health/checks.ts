import { and, gte, inArray, sql } from 'drizzle-orm';
import { type AIProvider, DISABLED_PROVIDER_NAME } from '@jave/ai';
import { pingDatabase, webhookDeliveries } from '@jave/database';
import { getQueueStats, type HealthCheck, type HealthResult, type Worker } from '@jave/core';
import type { Database } from '@jave/database';
import type { Clock } from '@jave/core';
import type { DiscordGateway } from '../discord/gateway';
import { GLYPH } from '../ui/theme';

/** A queue that has not been drained for this long is considered stuck. */
export const QUEUE_STALL_SECONDS = 300;
const DAY_MS = 86_400_000;
/**
 * Provider health is a network call (e.g. a model lookup): reuse a result for
 * a minute so frequent /readyz probes and /jave status do not hammer it.
 */
export const AI_HEALTH_CACHE_MS = 60_000;

export interface HealthDeps {
  db: Database;
  clock: Clock;
  gateway: DiscordGateway;
  worker: Pick<Worker, 'status'> | null;
  pollMs: number;
  ai: AIProvider;
  extra?: HealthCheck[];
}

type CheckResult = Omit<HealthResult, 'name'>;

/**
 * `ai`: disabled when AI_PROVIDER=disabled, otherwise ok/down from
 * `provider.health()`. Results are cached for AI_HEALTH_CACHE_MS and
 * concurrent probes share one in-flight call. Non-critical.
 */
export function aiHealthCheck(provider: AIProvider, clock: Clock): HealthCheck {
  let cached: { at: number; result: CheckResult } | null = null;
  let inFlight: Promise<CheckResult> | null = null;
  const probe = async (): Promise<CheckResult> => {
    try {
      const health = await provider.health();
      return health.ok
        ? { status: 'ok', detail: `${provider.name} ${GLYPH.dot} ${provider.defaultModel}` }
        : { status: 'down', detail: health.detail };
    } catch {
      return { status: 'down', detail: `${provider.name} health check failed` };
    }
  };
  return {
    name: 'ai',
    critical: false,
    run: async () => {
      if (provider.name === DISABLED_PROVIDER_NAME) {
        return { status: 'disabled', detail: 'AI_PROVIDER=disabled' };
      }
      const now = clock.now().getTime();
      if (cached && now - cached.at < AI_HEALTH_CACHE_MS) return cached.result;
      inFlight ??= probe().finally(() => {
        inFlight = null;
      });
      const result = await inFlight;
      cached = { at: clock.now().getTime(), result };
      return result;
    },
  };
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
    aiHealthCheck(deps.ai, deps.clock),
    ...(deps.extra ?? []),
  ];
}
