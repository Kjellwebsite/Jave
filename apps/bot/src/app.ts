import {
  coreJobHandlers,
  coreRecurringJobs,
  createContext,
  enqueueRecurring,
  type HealthCheck,
  type JobHandlerMap,
  runHealthChecks,
  systemActor,
  Worker,
} from '@jave/core';
import type { Database } from '@jave/database';
import type { Clock, CoreConfig, Logger, TtlCache } from '@jave/core';
import type { DiscordGateway } from './discord/gateway';
import type { BotFeature } from './features/types';
import type {
  IncomingMessage,
  JoinedMember,
  MessageDeletion,
  MessageUpdate,
} from './gateway-events/types';
import { botHealthChecks } from './health/checks';
import { InteractionRouter } from './interactions/router';
import type { CommandDefinition } from './interactions/types';
import type { BotServices } from './runtime';

export interface BotAppOptions {
  db: Database;
  clock: Clock;
  logger: Logger;
  cache: TtlCache;
  config: CoreConfig;
  discord: { clientId: string; guildId: string };
  gateway: DiscordGateway;
  features: BotFeature[];
  worker: { concurrency: number; pollMs: number };
  extraHealthChecks?: HealthCheck[];
}

export interface BotApp {
  services: BotServices;
  router: InteractionRouter;
  worker: Worker;
  features: BotFeature[];
  commands: CommandDefinition[];
  events: GatewayDispatcher;
}

export interface GatewayDispatcher {
  ready(): Promise<void>;
  message(message: IncomingMessage): Promise<void>;
  messageUpdate(update: MessageUpdate): Promise<void>;
  messageDelete(deletion: MessageDeletion): Promise<void>;
  memberJoin(member: JoinedMember): Promise<void>;
  memberLeave(userId: string): Promise<void>;
  invitesChanged(): Promise<void>;
}

/** Merge job handler maps, refusing duplicates (two owners for one job type is a bug). */
export function mergeHandlers(...maps: JobHandlerMap[]): JobHandlerMap {
  const out: Record<string, JobHandlerMap[string]> = {};
  for (const map of maps) {
    for (const [type, handler] of Object.entries(map)) {
      if (out[type]) throw new Error(`duplicate job handler for ${type}`);
      out[type] = handler;
    }
  }
  return out;
}

/**
 * Composition root shared by main.ts and the test harness: services, router,
 * worker (core handlers + every feature's Discord handlers) and gateway-event
 * dispatch with per-feature error isolation.
 */
export function createBotApp(options: BotAppOptions): BotApp {
  let worker: Worker | null = null;
  const services: BotServices = {
    db: options.db,
    clock: options.clock,
    logger: options.logger,
    cache: options.cache,
    config: options.config,
    discord: options.discord,
    gateway: options.gateway,
    runJobsNow: async (ids) => {
      if (worker) await worker.runNow(ids);
    },
    health: () =>
      runHealthChecks(
        botHealthChecks({
          db: options.db,
          clock: options.clock,
          gateway: options.gateway,
          worker,
          pollMs: options.worker.pollMs,
          extra: options.extraHealthChecks,
        }),
      ),
  };

  const systemContext = (reason: string, requestId?: string) =>
    createContext({
      db: options.db,
      clock: options.clock,
      cache: options.cache,
      config: options.config,
      logger: options.logger,
      actor: systemActor(reason),
      requestId,
    });

  const handlers = mergeHandlers(
    coreJobHandlers(),
    ...options.features.map((f) => f.jobHandlers?.(services) ?? {}),
  );
  worker = new Worker({
    db: options.db,
    handlers,
    logger: options.logger.child({ component: 'worker' }),
    clock: options.clock,
    concurrency: options.worker.concurrency,
    pollMs: options.worker.pollMs,
    recurring: coreRecurringJobs,
    contextFor: (job) => systemContext(`job:${job.type}`, `job_${job.id}`),
    scheduleRecurring: async (jobs) => {
      const ctx = systemContext('scheduler');
      for (const job of jobs) await enqueueRecurring(ctx, job.type, job.everyMs, job.payload ?? {});
    },
  });

  const router = new InteractionRouter(options.features, services);

  const fanOut = async <K extends keyof BotFeature>(
    event: K,
    invoke: (listener: NonNullable<BotFeature[K]>) => Promise<void>,
  ) => {
    await Promise.all(
      options.features.map(async (feature) => {
        const listener = feature[event];
        if (!listener) return;
        try {
          await invoke(listener as NonNullable<BotFeature[K]>);
        } catch (error) {
          options.logger.error(
            { err: error, feature: feature.name, event },
            'gateway event handler failed',
          );
        }
      }),
    );
  };

  const events: GatewayDispatcher = {
    ready: () => fanOut('onReady', (fn) => fn(services)),
    message: (m) => fanOut('onMessage', (fn) => fn(services, m)),
    messageUpdate: (u) => fanOut('onMessageUpdate', (fn) => fn(services, u)),
    messageDelete: (d) => fanOut('onMessageDelete', (fn) => fn(services, d)),
    memberJoin: (m) => fanOut('onMemberJoin', (fn) => fn(services, m)),
    memberLeave: (id) => fanOut('onMemberLeave', (fn) => fn(services, id)),
    invitesChanged: () => fanOut('onInvitesChanged', (fn) => fn(services)),
  };

  return {
    services,
    router,
    worker,
    features: options.features,
    commands: router.listCommands(),
    events,
  };
}
