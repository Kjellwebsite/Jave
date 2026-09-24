import { referralCodes } from '@jave/database';
import { createEventHandlers } from '../events/bus';
import type { JobHandlerMap } from '../jobs/worker';
import type { UserActor } from '../permissions/actor';
import { updateSettings } from '../settings/settings.service';
import type { Settings } from '../settings/schemas';
import type { TestKit } from '../testing';
import { getOrCreateDraft, submitApplication, updateDraft } from './applicant.service';
import { jobHandlers } from './index';
import type { UpdateDraftInput } from './schemas';

/** Test-only helpers for the applications module. */

/**
 * PGlite-backed suites are slow on a loaded shared machine. Generous limits
 * keep them from timing out there; no assertion depends on them.
 */
export const PGLITE_SUITE_TIMEOUTS = { testTimeout: 180_000, hookTimeout: 180_000 } as const;

export const COMPLETE_DRAFT = {
  domainKey: 'create',
  motivation: 'I want to ship real products with people who hold a higher bar than I do.',
  experience: 'Three years building web apps; led a team of four on a logistics dashboard.',
  projects: 'Shipped an open-source scheduling tool used by two schools.',
  portfolioUrl: 'https://example.com/portfolio',
  evidenceLinks: ['https://github.com/example/scheduler'],
  references: 'Jane Doe, CTO at Example — jane@example.com',
} satisfies UpdateDraftInput;

/** Module job handlers plus the event dispatcher (no subscribers). */
export function applicationHandlers(): JobHandlerMap {
  return { ...jobHandlers, ...createEventHandlers([]) };
}

export async function setApplicationSettings(
  kit: TestKit,
  patch: Partial<Settings<'applications'>>,
): Promise<void> {
  await updateSettings(kit.system, 'applications', patch);
}

/** A plain MEMBER with a complete draft. */
export async function draftingApplicant(
  kit: TestKit,
  fields: UpdateDraftInput = COMPLETE_DRAFT,
): Promise<{ applicant: UserActor; applicationId: string }> {
  const applicant = await kit.member();
  const { application } = await getOrCreateDraft(kit.as(applicant));
  await updateDraft(kit.as(applicant), fields);
  return { applicant, applicationId: application.id };
}

/** A plain MEMBER whose application is SUBMITTED. */
export async function submittedApplicant(
  kit: TestKit,
): Promise<{ applicant: UserActor; applicationId: string }> {
  const drafted = await draftingApplicant(kit);
  await submitApplication(kit.as(drafted.applicant));
  return drafted;
}

export async function createReferralCode(
  kit: TestKit,
  owner: UserActor,
  code: string,
  active = true,
): Promise<void> {
  await kit.db.insert(referralCodes).values({ code, ownerUserId: owner.userId, active });
}
