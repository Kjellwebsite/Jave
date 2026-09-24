import type { CommandDefinition } from '../interactions/types';
import type { BotFeature } from './types';
import { coreFeature } from './core';
import { feature as achievements } from './achievements';
import { feature as adversarial } from './adversarial';
import { feature as ai } from './ai';
import { feature as applications } from './applications';
import { feature as events } from './events';
import { feature as games } from './games';
import { feature as integrations } from './integrations';
import { feature as invites } from './invites';
import { feature as missions } from './missions';
import { feature as moderation } from './moderation';
import { feature as projects } from './projects';
import { feature as research } from './research';
import { feature as tickets } from './tickets';
import { feature as trials } from './trials';
import { feature as verification } from './verification';

/** Composition root of every Discord feature. */
export function allFeatures(): BotFeature[] {
  const domainFeatures: BotFeature[] = [
    applications,
    verification,
    trials,
    adversarial,
    missions,
    projects,
    events,
    achievements,
    tickets,
    moderation,
    invites,
    integrations,
    research,
    ai,
    games,
  ];
  let catalog: readonly CommandDefinition[] = [];
  const core = coreFeature(() => catalog);
  const features = [core, ...domainFeatures];
  catalog = features.flatMap((f) => f.commands ?? []);
  return features;
}

export type { BotFeature } from './types';
