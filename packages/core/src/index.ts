// Kernel
export * from './kernel/errors';
export * from './kernel/clock';
export * from './kernel/crypto';
export * from './kernel/ids';
export * from './kernel/redact';
export * from './kernel/logger';
export * from './kernel/cache';
export * from './kernel/context';
export * from './kernel/validation';
export * from './kernel/pagination';

// Permissions
export * from './permissions/roles';
export * from './permissions/capabilities';
export * from './permissions/actor';
export * from './permissions/authorize';

// Platform services
export * from './audit/audit.service';
export * from './events/catalog';
export * from './events/bus';
export * from './jobs/queue';
export * from './jobs/worker';
export * from './settings/schemas';
export * from './settings/settings.service';
export * from './notifications/catalog';
export * from './notifications/quiet-hours';
export * from './notifications/notifications.service';
export * from './rate-limit/rate-limit';
export * from './observability/health';

// Domain modules
export * from './identity';

// Domain modules are namespaced to keep service names unambiguous:
//   import { trials } from '@jave/core'; trials.startTrial(ctx, …)
export * as applications from './applications';
export * as verification from './verification';
export * as trials from './trials';
export * as adversarial from './adversarial';
export * as tickets from './tickets';
export * as moderation from './moderation';
export * as invites from './invites';
export * as analytics from './analytics';
export * as achievements from './achievements';
export * as missions from './missions';
export * as projects from './projects';
export * as integrations from './integrations';
export * as calendar from './calendar';
export * as games from './games';
export * as ai from './ai';
export * as research from './research';

export { coreJobHandlers, coreRecurringJobs, coreSubscribers } from './registry';
