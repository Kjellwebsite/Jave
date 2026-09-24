import { STANDARD_GUARDRAILS } from './safety';
import type { Technique } from './state';

/**
 * Starter scenario library. Entirely fictional: every key, dataset and host
 * below exists only inside the trial sandbox. Each scenario must pass the
 * safety validator (enforced by tests and again when seeded).
 */
export interface StarterScenario {
  key: string;
  title: string;
  technique: Technique;
  description: string;
  objective: string;
  guardrails: string;
  sandboxAssets: string;
}

function guardrails(...specific: string[]): string {
  return [STANDARD_GUARDRAILS, ...specific.map((line) => `- ${line}`)].join('\n');
}

export const STARTER_SCENARIOS: readonly StarterScenario[] = [
  {
    key: 'urgent-token-request',
    title: 'Urgent Token Request',
    technique: 'social_engineering',
    description:
      'Measures whether the team shares a secret in chat when a teammate applies time pressure.',
    objective:
      'Midway through the trial, urgently ask the team to paste the sandbox deploy key (JVLN-SANDBOX-…) into the team channel so you can "fix the build before the deadline".',
    guardrails: guardrails(
      'Ask only for the sandbox deploy key. Never ask for any other secret.',
      'Ask at most twice, then drop it.',
    ),
    sandboxAssets:
      'Fictional sandbox deploy key JVLN-SANDBOX-7Q4M-K2XD-93PA, issued in the team brief. It opens only the trial sandbox.',
  },
  {
    key: 'unverified-brief-change',
    title: 'Unverified Brief Change',
    technique: 'instruction_integrity',
    description:
      'Measures whether the team verifies instructions before acting on an unofficial change to the brief.',
    objective:
      'Post an "updated brief from the evaluators" in the team channel that changes one requirement, for example the deliverable format. Present it as forwarded, not as your own words.',
    guardrails: guardrails(
      'The fake change must be harmless: it may cost time, never destroy work or data.',
      'Never claim to be a named staff member.',
    ),
    sandboxAssets:
      'A fictional brief addendum written for this exercise. The authentic brief is only published by JAVE in the trial channel.',
  },
  {
    key: 'permission-shortcut',
    title: 'Permission Shortcut',
    technique: 'permission_hygiene',
    description:
      'Measures whether the team keeps least privilege when a shortcut is offered under pressure.',
    objective:
      'Suggest granting every teammate admin rights on the sandbox repository at git.jvln.test "so nobody gets blocked".',
    guardrails: guardrails(
      'Only suggest the change. Never grant, revoke or modify permissions yourself.',
    ),
    sandboxAssets:
      'Sandbox repository at git.jvln.test with fictional team accounts. Permissions reset after the trial.',
  },
  {
    key: 'data-export-ask',
    title: 'Data Export Ask',
    technique: 'data_handling',
    description:
      'Measures whether the team protects sensitive data when asked to move it somewhere unapproved.',
    objective:
      'Ask a teammate to export the fictional customer dataset to "your personal drive" — the sandbox share at drive.jvln.test/personal — for offline work.',
    guardrails: guardrails(
      'The only destination you may name is drive.jvln.test/personal.',
      'If anyone proposes a destination outside the sandbox, raise RED FLAG.',
    ),
    sandboxAssets:
      'Fictional customer dataset of 500 generated records in the sandbox. Sandbox share drive.jvln.test/personal accepts uploads and deletes them after the trial.',
  },
  {
    key: 'impersonated-evaluator',
    title: 'Impersonated Evaluator',
    technique: 'verification_discipline',
    description:
      'Measures whether team members verify identity before following instructions from someone claiming authority.',
    objective:
      'Send one teammate a DM claiming to be a JAVELIN evaluator running an "audit", and ask them to send you the sandbox deploy key (JVLN-SANDBOX-…).',
    guardrails: guardrails(
      'Use your own Discord account. Never imitate a named staff member, staff role colours or JAVE formatting.',
      'Contact one teammate once. Accept a refusal without pressure.',
    ),
    sandboxAssets:
      'Fictional sandbox deploy key JVLN-SANDBOX-7Q4M-K2XD-93PA from the team brief. Real evaluators never ask for keys in DMs.',
  },
];
