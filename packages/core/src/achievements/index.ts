import type { EventSubscriber } from '../events/bus';
import type { JobHandlerMap, RecurringJob } from '../jobs/worker';
import { achievementEngineSubscriber, evaluateDefinitionJob } from './engine';
import { ACHIEVEMENT_EVALUATE_JOB } from './store';

// Module: achievements — data-driven achievement definitions, the rule engine,
// manual awards, and member/catalog views.

export {
  ACHIEVEMENT_EVENT_TYPES,
  ACHIEVEMENT_RARITIES,
  ACHIEVEMENT_VISIBILITIES,
  FIRST_STEP_ONLY_EVENTS,
  FIRST_STEP_THRESHOLD,
  MAX_EVENT_THRESHOLD,
  achievementAnnouncementLine,
  achievementCriteriaSchema,
  achievementHeadline,
  holderPercent,
  isAchievementEventType,
  unlockSummary,
  type AchievementCriteriaInput,
  type AchievementEventType,
  type AchievementRarity,
  type AchievementVisibility,
  type ParsedAchievementCriteria,
} from './criteria';
export { STARTER_ACHIEVEMENTS, type StarterAchievement } from './starter';
export {
  awardAchievementSchema,
  createDefinitionSchema,
  revokeAchievementSchema,
  updateDefinitionSchema,
} from './schemas';
export {
  createAchievementDefinition,
  deleteAchievementDefinition,
  getAchievementDefinition,
  listAchievementDefinitions,
  seedStarterAchievements,
  updateAchievementDefinition,
  type SeedResult,
} from './definitions.service';
export {
  awardAchievement,
  awardAchievementFromSystem,
  revokeAchievement,
  verifyMemberAchievement,
  type SystemAwardOutcome,
} from './award.service';
export {
  ACHIEVEMENT_ENGINE_SUBSCRIBER,
  EVALUATION_BATCH_SIZE,
  achievementEngineSubscriber,
  evaluateEventForAchievements,
} from './engine';
export {
  HIDDEN_DESCRIPTION,
  HIDDEN_SUMMARY,
  HIDDEN_TITLE,
  getAchievementCatalog,
  getAchievementRarityStats,
  listMemberAchievements,
  type CatalogEntry,
  type MemberAchievementView,
  type RarityStat,
  type RarityStats,
} from './views.service';
export {
  DISCORD_ACHIEVEMENT_ANNOUNCE_JOB,
  DISCORD_ACHIEVEMENT_RETRACT_JOB,
  achievementAnnouncePayloadSchema,
  achievementRetractPayloadSchema,
  getAchievementAnnouncement,
  markAchievementAnnounced,
  type AchievementAnnouncement,
  type AchievementAnnouncePayload,
  type AchievementRetractPayload,
} from './discord-jobs';
export {
  ACHIEVEMENT_EVALUATE_JOB,
  type AchievementDefinitionRecord,
  type MemberAchievementRecord,
} from './store';

/** Job handlers owned by this module (non-Discord). */
export const jobHandlers: JobHandlerMap = {
  [ACHIEVEMENT_EVALUATE_JOB]: evaluateDefinitionJob,
};
/** Domain event subscribers owned by this module. */
export const subscribers: readonly EventSubscriber[] = [achievementEngineSubscriber];
/** Periodic work owned by this module. */
export const recurringJobs: readonly RecurringJob[] = [];
