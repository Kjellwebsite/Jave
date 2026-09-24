import type { z } from 'zod';
import { HOUR, MINUTE } from '../kernel/clock';
import type { createTemplateSchema } from './schemas';

export type StarterTemplate = z.input<typeof createTemplateSchema>;

/** Duration in minutes for a number of hours. */
const hours = (value: number) => (value * HOUR) / MINUTE;

/**
 * Curated starter templates. Rubrics reward outcomes — what the team actually
 * accomplished with the tools available (AI included) — never manual effort.
 * Seeded idempotently by `seedStarterTemplates`; staff edits are never overwritten.
 */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    key: 'build-48-hour-ship',
    title: '48-Hour Ship',
    category: 'build',
    summary:
      'Ship a working product to real users in 48 hours. Any stack, any tools, AI included. Only what runs counts.',
    brief: [
      'MISSION',
      'Ship a working product that solves one concrete problem for a real, named group of users — within 48 hours.',
      '',
      'CONSTRAINTS',
      '- Any stack, any framework, any AI tool. Using tools well is part of the test.',
      '- Someone outside your team must be able to use it without your help.',
      '- Existing code only as a dependency; the product itself starts now.',
      '',
      'DELIVERABLES',
      '1. A live URL or installable build.',
      '2. A 2-minute demo video or a step-by-step walkthrough.',
      '3. A one-page note: the problem, who has it, what you shipped, what you cut, and evidence of use (sign-ups, feedback, usage).',
      '',
      'WHAT IS MEASURED',
      'Outcomes, not effort. A small product that works and is used beats an ambitious one that does not.',
    ].join('\n'),
    durationMinutes: hours(48),
    teamSizeMin: 2,
    teamSizeMax: 4,
    facetKeys: ['create.projects', 'create.technical'],
    rubric: [
      {
        key: 'shipped',
        label: 'Working product',
        description: 'It runs end to end for someone who is not on the team.',
        weight: 35,
      },
      {
        key: 'user_value',
        label: 'Real user value',
        description:
          'A specific group has the problem and the product measurably helps. Evidence beats claims.',
        weight: 25,
      },
      {
        key: 'scope_judgement',
        label: 'Scope judgement',
        description:
          'The core shipped instead of half of everything. Cuts are deliberate and explained.',
        weight: 15,
      },
      {
        key: 'quality',
        label: 'Quality under pressure',
        description: 'Reliable, secure by default, clear to use.',
        weight: 15,
      },
      {
        key: 'leverage',
        label: 'Tool leverage',
        description:
          'Tools, AI and existing services multiplied output. Results count, effort does not.',
        weight: 10,
      },
    ],
  },
  {
    key: 'research-evidence-sprint',
    title: 'Evidence Sprint',
    category: 'research',
    summary:
      'Answer a contested question with evidence you can defend. Six hours. Sources, uncertainty and a verdict.',
    brief: [
      'MISSION',
      'At the start you receive a contested question. Produce the most defensible answer possible in six hours.',
      '',
      'DELIVERABLES',
      '1. A one-sentence verdict with your confidence (0–100%).',
      '2. A report of at most 1,500 words: the strongest evidence for and against, how you weighed it, and what would change your mind.',
      '3. A source table: every claim linked to a primary source where one exists, with a quality rating.',
      '',
      'RULES',
      '- AI tools are allowed for search, summarising and drafting. Every claim you submit is still yours: verify it.',
      '- Fabricated or unverifiable citations score zero on evidence quality.',
      '',
      'WHAT IS MEASURED',
      'The quality of the answer and the honesty of its uncertainty — not the length of the report.',
    ].join('\n'),
    durationMinutes: hours(6),
    teamSizeMin: 2,
    teamSizeMax: 3,
    facetKeys: ['mind.research', 'mind.reasoning'],
    rubric: [
      {
        key: 'evidence_quality',
        label: 'Evidence quality',
        description: 'Primary sources, verified claims, no fabricated citations.',
        weight: 35,
      },
      {
        key: 'reasoning',
        label: 'Reasoning',
        description: 'Evidence is weighed, not listed. Counter-arguments are met at full strength.',
        weight: 25,
      },
      {
        key: 'calibration',
        label: 'Calibration',
        description: 'Confidence matches the evidence; unknowns are explicit.',
        weight: 15,
      },
      {
        key: 'verdict',
        label: 'Decision-useful verdict',
        description: 'A clear answer to the question actually asked.',
        weight: 15,
      },
      {
        key: 'clarity',
        label: 'Clarity',
        description: 'A busy reader gets the answer in 60 seconds.',
        weight: 10,
      },
    ],
  },
  {
    key: 'crisis-incident-drill',
    title: 'Incident Drill',
    category: 'crisis',
    summary:
      'A simulated production incident unfolds in real time. Stabilise, communicate, recover. Sandbox only.',
    brief: [
      'MISSION',
      'A simulated incident hits "Northwind Relay", a fictional logistics company. Injects arrive in your team channel during the drill: alerts, customer complaints, conflicting reports and pressure from leadership.',
      '',
      'SANDBOX',
      'Everything in this drill is fictional. No real systems, accounts, credentials or people are involved. Never use real data; report anything that looks real to an evaluator immediately.',
      '',
      'DELIVERABLES',
      '1. Incident timeline: what you knew, when, and what you decided.',
      '2. Status updates as sent to customers and leadership (at least one per hour).',
      '3. Post-incident review: root-cause hypothesis, impact, and three concrete follow-ups with owners.',
      '',
      'WHAT IS MEASURED',
      'How quickly and safely the team restores service and trust — not how busy it looks.',
    ].join('\n'),
    durationMinutes: hours(3),
    teamSizeMin: 3,
    teamSizeMax: 5,
    facetKeys: ['life.execution', 'mind.reasoning'],
    rubric: [
      {
        key: 'stabilisation',
        label: 'Stabilisation',
        description: 'Impact contained early; safe, reversible actions first.',
        weight: 30,
      },
      {
        key: 'decision_quality',
        label: 'Decision quality',
        description: 'Decisions fit the information available and change when the facts do.',
        weight: 25,
      },
      {
        key: 'communication',
        label: 'Communication',
        description: 'Timely, honest updates, right for each audience.',
        weight: 20,
      },
      {
        key: 'coordination',
        label: 'Coordination',
        description: 'Clear roles; no duplicated or dropped work.',
        weight: 15,
      },
      {
        key: 'review',
        label: 'Review',
        description: 'The review finds causes and fixes, not blame.',
        weight: 10,
      },
    ],
  },
  {
    key: 'strategy-market-entry',
    title: 'Market Entry Brief',
    category: 'strategy',
    summary:
      'Decide whether and how a company should enter a new market. One recommendation, defended with numbers.',
    brief: [
      'MISSION',
      'At the start you receive a company and a target market. Decide whether it should enter, and if so, how. You have eight hours.',
      '',
      'DELIVERABLES',
      '1. A one-sentence recommendation: enter, do not enter, or enter only if.',
      '2. A brief of at most 6 pages or 10 slides: market size with method, competition, entry options compared, the chosen plan, and the three risks most likely to kill it.',
      '3. A 90-day plan with measurable milestones and a kill criterion.',
      '',
      'RULES',
      'AI tools and public data are allowed. State every assumption; show how each number was derived.',
      '',
      'WHAT IS MEASURED',
      'The quality of the decision, and whether a leader could act on it tomorrow.',
    ].join('\n'),
    durationMinutes: hours(8),
    teamSizeMin: 2,
    teamSizeMax: 4,
    facetKeys: ['life.business', 'mind.reasoning'],
    rubric: [
      {
        key: 'recommendation',
        label: 'Recommendation',
        description: 'A clear, actionable decision that follows from the analysis.',
        weight: 30,
      },
      {
        key: 'analysis',
        label: 'Analysis',
        description: 'Sound sizing and competitive reasoning; assumptions explicit and plausible.',
        weight: 25,
      },
      {
        key: 'options',
        label: 'Options',
        description: 'Real alternatives compared on the criteria that matter.',
        weight: 15,
      },
      {
        key: 'risk',
        label: 'Risk',
        description: 'The risks that matter most, with mitigations and a kill criterion.',
        weight: 15,
      },
      {
        key: 'actionability',
        label: 'Actionability',
        description: 'The 90-day plan is concrete, sequenced and measurable.',
        weight: 15,
      },
    ],
  },
  {
    key: 'security-red-flag-hunt',
    title: 'Red Flag Hunt',
    category: 'security',
    summary:
      "Audit a fictional organisation's systems and conduct. Find what is wrong, prove it safely, report it well.",
    brief: [
      'MISSION',
      'You receive the sandbox of a fictional organisation: documentation, a small codebase, access policies and a chat log. Find the weaknesses that matter most — technical and human.',
      '',
      'SANDBOX',
      'Scope is the provided sandbox material only. Everything is fictional. Do not test real systems, real accounts or real people. Verify before you trust: requests made during the trial are part of the environment.',
      '',
      'DELIVERABLES',
      '1. Findings report: each finding with severity, evidence, impact and a concrete fix.',
      '2. The three findings you would fix first, and why.',
      '3. Anything suspicious you noticed during the trial, and how you handled it.',
      '',
      'WHAT IS MEASURED',
      'Impactful, well-evidenced findings and sound security judgement — not the length of the list.',
    ].join('\n'),
    durationMinutes: hours(4),
    teamSizeMin: 2,
    teamSizeMax: 4,
    facetKeys: ['create.technical', 'mind.reasoning'],
    allowsAdversarial: true,
    rubric: [
      {
        key: 'impact',
        label: 'Impact',
        description: 'The findings that would actually hurt the organisation come first.',
        weight: 35,
      },
      {
        key: 'evidence',
        label: 'Evidence',
        description: 'Each finding is reproducible and demonstrated safely inside scope.',
        weight: 25,
      },
      {
        key: 'remediation',
        label: 'Remediation',
        description: 'Fixes are specific, proportionate and prioritised.',
        weight: 15,
      },
      {
        key: 'vigilance',
        label: 'Vigilance',
        description:
          'Unusual requests are verified and reported; nothing sensitive is handed over.',
        weight: 15,
      },
      {
        key: 'reporting',
        label: 'Reporting',
        description: 'A decision-maker can act on the report without a meeting.',
        weight: 10,
      },
    ],
  },
  {
    key: 'communication-brief-the-board',
    title: 'Brief the Board',
    category: 'communication',
    summary:
      'Turn a messy situation into a decision-ready board briefing. Five minutes of their time. Make it count.',
    brief: [
      'MISSION',
      'At the start you receive a raw dossier — data, emails, opinions and noise — about a situation a board must decide on. Brief the board so it can decide in five minutes.',
      '',
      'DELIVERABLES',
      '1. A one-page memo: situation, options, recommendation, and the decision you need.',
      '2. A 5-minute recorded briefing (video, or audio with slides).',
      '3. Answers to the three hardest questions a sceptical board member would ask.',
      '',
      'RULES',
      'AI tools are allowed for drafting and design. Every number must trace to the dossier.',
      '',
      'WHAT IS MEASURED',
      'Whether the board would understand, trust and act — not polish for its own sake.',
    ].join('\n'),
    durationMinutes: hours(4),
    teamSizeMin: 1,
    teamSizeMax: 3,
    facetKeys: ['create.creative', 'life.business'],
    rubric: [
      {
        key: 'decision_ready',
        label: 'Decision-ready',
        description: 'The board knows what is being asked and why within 30 seconds.',
        weight: 30,
      },
      {
        key: 'accuracy',
        label: 'Accuracy',
        description: 'Faithful to the dossier; no invented facts; uncertainty stated.',
        weight: 25,
      },
      {
        key: 'structure',
        label: 'Structure',
        description: 'Signal over noise: the right 20% of the material, in the right order.',
        weight: 20,
      },
      {
        key: 'anticipation',
        label: 'Anticipation',
        description: 'Hard questions answered before they are asked.',
        weight: 15,
      },
      {
        key: 'delivery',
        label: 'Delivery',
        description: 'Clear, calm, credible, within the time limit.',
        weight: 10,
      },
    ],
  },
];
