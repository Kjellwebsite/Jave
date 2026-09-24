import type { VerificationStrategy, VerificationType } from '../types';
import { achievementStrategy } from './achievement';
import { contributionStrategy } from './contribution';
import { identityStrategy } from './identity';
import { projectStrategy } from './project';
import { skillStrategy } from './skill';
import { trialStrategy } from './trial';

/**
 * Strategy registry: one entry per verification type. Adding a type means a
 * new enum value, a target schema (schemas.ts), a target key (rules.ts) and a
 * strategy here — the services stay unchanged.
 */
export const VERIFICATION_STRATEGIES: Readonly<Record<VerificationType, VerificationStrategy>> = {
  identity: identityStrategy,
  skill: skillStrategy,
  project: projectStrategy,
  contribution: contributionStrategy,
  achievement: achievementStrategy,
  trial: trialStrategy,
};

export function strategyFor(type: VerificationType): VerificationStrategy {
  return VERIFICATION_STRATEGIES[type];
}

export { classifyIdentityRoles, IDENTITY_ELIGIBLE_ROLES } from './identity';
