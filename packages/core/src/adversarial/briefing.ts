import {
  OUTCOME_LABELS,
  type Outcome,
  type RoleStatus,
  type Technique,
  TECHNIQUE_LABELS,
} from './state';
import { STOP_WORD } from './safety';
import type { OutcomeCounts } from './scoring';

/**
 * Operative briefing and team debrief (pure builders).
 *
 * The briefing ALWAYS carries the guardrails and the stop-word protocol —
 * there is no code path that renders an operative briefing without them.
 */

export const STOP_PROTOCOL = [
  `STOP WORD: ${STOP_WORD}.`,
  `If anyone — you, a participant or staff — says or types ${STOP_WORD}, the exercise ends immediately.`,
  'Stop all adversarial activity, send nothing further, and report to staff at once.',
  'No questions asked, no penalty.',
].join(' ');

export const OPERATING_RULES: readonly string[] = [
  'Act only while staff has marked the exercise ACTIVE.',
  'Stay inside your objective and triggers. Improvise nothing beyond them.',
  'Keep your role confidential until the official reveal.',
  'If anything feels unsafe or unclear, stop and raise RED FLAG.',
];

export interface BriefingTrigger {
  id: string;
  label: string;
  description: string;
  plannedFor: Date | null;
  firedAt: Date | null;
}

export interface BriefingInput {
  roleId: string;
  status: RoleStatus;
  revision: number;
  trial: { number: number; title: string };
  team: { name: string } | null;
  scenario: { title: string; technique: Technique };
  objective: string;
  sandboxAssets: string;
  guardrails: string;
  triggers: readonly BriefingTrigger[];
}

export interface BriefingView extends BriefingInput {
  techniqueLabel: string;
  exerciseActive: boolean;
  stopWord: string;
  stopProtocol: string;
  operatingRules: readonly string[];
}

export function buildBriefing(input: BriefingInput): BriefingView {
  return {
    ...input,
    triggers: [...input.triggers],
    techniqueLabel: TECHNIQUE_LABELS[input.scenario.technique],
    exerciseActive: input.status === 'active',
    stopWord: STOP_WORD,
    stopProtocol: STOP_PROTOCOL,
    operatingRules: OPERATING_RULES,
  };
}

function statusLine(status: RoleStatus): string {
  switch (status) {
    case 'active':
      return 'STATUS — ACTIVE. Proceed per your objective.';
    case 'briefed':
      return 'STATUS — BRIEFED. Stand by until staff marks the exercise ACTIVE.';
    case 'concluded':
      return 'STATUS — CONCLUDED. Stand down.';
    case 'aborted':
      return 'STATUS — STOPPED. Stand down immediately.';
    case 'revealed':
      return 'STATUS — REVEALED. The exercise is over.';
    case 'planned':
      return 'STATUS — PLANNED.';
  }
}

function formatTrigger(trigger: BriefingTrigger): string {
  const when = trigger.plannedFor ? ` (planned ${trigger.plannedFor.toISOString()})` : '';
  const fired = trigger.firedAt ? ' — FIRED' : '';
  return `- ${trigger.label}${when}${fired}: ${trigger.description}`;
}

/** Plain-text rendering (DMs, dashboard fallback). Sections are fixed and always present. */
export function renderBriefingText(view: BriefingView): string {
  const team = view.team ? ` — ${view.team.name}` : '';
  const triggers = view.triggers.length
    ? view.triggers.map(formatTrigger).join('\n')
    : '- None scheduled. Staff will tell you when to act.';
  return [
    `CONFIDENTIAL BRIEFING — TRIAL #${view.trial.number}${team}`,
    `Revision ${view.revision}. ${statusLine(view.status)}`,
    '',
    `SCENARIO — ${view.scenario.title} (${view.techniqueLabel})`,
    `OBJECTIVE — ${view.objective}`,
    `SANDBOX ASSETS — ${view.sandboxAssets}`,
    '',
    'TRIGGERS',
    triggers,
    '',
    'GUARDRAILS',
    view.guardrails,
    '',
    'OPERATING RULES',
    ...view.operatingRules.map((rule) => `- ${rule}`),
    '',
    view.stopProtocol,
  ].join('\n');
}

export const STOP_NOTICE = {
  title: 'STOP — EXERCISE ENDED',
  body: 'Stop all adversarial activity now. Send nothing further. Keep the exercise confidential; staff will follow up.',
} as const;

export interface DebriefInput {
  roleId: string;
  trial: { number: number; title: string };
  team: { name: string } | null;
  scenario: { title: string; technique: Technique };
  operative: { displayName: string };
  securityCultureScore: number;
  outcomes: OutcomeCounts;
  debrief: string;
  stoppedEarly: boolean;
}

export interface DebriefView extends DebriefInput {
  title: string;
  techniqueLabel: string;
  disclosure: string;
}

export const DEBRIEF_DISCLOSURE =
  'This was an authorized security-culture exercise. Fictional data and sandbox accounts only. The operative acted under two-person staff authorization.';

export function buildDebrief(input: DebriefInput): DebriefView {
  return {
    ...input,
    title: `EXERCISE REVEALED — TRIAL #${input.trial.number}`,
    techniqueLabel: TECHNIQUE_LABELS[input.scenario.technique],
    disclosure: DEBRIEF_DISCLOSURE,
  };
}

/** Aggregated outcomes only — the public debrief never names individual participants. */
export function formatOutcomeCounts(counts: OutcomeCounts): string {
  const parts = (Object.keys(OUTCOME_LABELS) as Outcome[])
    .filter((outcome) => counts[outcome] > 0)
    .map((outcome) => `${OUTCOME_LABELS[outcome]} ${counts[outcome]}`);
  return parts.length ? parts.join(' · ') : 'No observations recorded';
}

export function renderDebriefText(view: DebriefView): string {
  const team = view.team ? ` — ${view.team.name}` : '';
  return [
    `${view.title}${team}`,
    view.disclosure,
    '',
    `SCENARIO — ${view.scenario.title} (${view.techniqueLabel})`,
    `OPERATIVE — ${view.operative.displayName}`,
    `SECURITY CULTURE — ${view.securityCultureScore}/10`,
    `OBSERVED — ${formatOutcomeCounts(view.outcomes)}`,
    ...(view.stoppedEarly ? ['The exercise was stopped early.'] : []),
    '',
    'DEBRIEF',
    view.debrief,
  ].join('\n');
}
