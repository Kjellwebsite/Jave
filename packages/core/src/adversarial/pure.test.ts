import { describe, expect, it } from 'vitest';
import { ROLE_CAPABILITIES } from '../permissions/capabilities';
import {
  buildBriefing,
  buildDebrief,
  formatOutcomeCounts,
  renderBriefingText,
  renderDebriefText,
  STOP_PROTOCOL,
} from './briefing';
import { STANDARD_GUARDRAILS, STOP_WORD } from './safety';
import { countOutcomes, SCORE_BASELINE, suggestScore } from './scoring';
import { acceptsObservations, isAwaitingReveal, type Outcome } from './state';

describe('suggested security-culture score', () => {
  it('has no basis without observations', () => {
    expect(suggestScore([])).toBeNull();
  });

  it('resisted, detected and reported raise it; partial and failure lower it', () => {
    expect(suggestScore(['resisted'])).toBe(SCORE_BASELINE + 1);
    expect(suggestScore(['detected'])).toBeGreaterThan(SCORE_BASELINE);
    expect(suggestScore(['reported'])).toBe(SCORE_BASELINE + 2);
    expect(suggestScore(['partial'])).toBe(SCORE_BASELINE - 1);
    expect(suggestScore(['failure'])).toBeLessThan(SCORE_BASELINE);
  });

  it('reporting counts more than resisting', () => {
    expect(suggestScore(['reported'])!).toBeGreaterThan(suggestScore(['resisted'])!);
  });

  it('clamps to 0–10 and returns integers', () => {
    expect(suggestScore(Array<Outcome>(20).fill('reported'))).toBe(10);
    expect(suggestScore(Array<Outcome>(20).fill('failure'))).toBe(0);
    for (const outcomes of [
      ['detected'],
      ['detected', 'failure'],
      ['partial', 'resisted'],
    ] as Outcome[][])
      expect(Number.isInteger(suggestScore(outcomes))).toBe(true);
  });

  it('is order-independent', () => {
    expect(suggestScore(['failure', 'reported', 'partial'])).toBe(
      suggestScore(['partial', 'failure', 'reported']),
    );
  });

  it('counts outcomes', () => {
    expect(countOutcomes(['failure', 'failure', 'reported'])).toEqual({
      resisted: 0,
      detected: 0,
      reported: 1,
      partial: 0,
      failure: 2,
    });
  });
});

describe('role state', () => {
  const base = { activatedAt: null, revealedAt: null } as const;
  it('awaits reveal only after an exercise that ran has ended', () => {
    expect(isAwaitingReveal({ ...base, status: 'concluded' })).toBe(true);
    expect(isAwaitingReveal({ ...base, status: 'aborted' })).toBe(false);
    expect(isAwaitingReveal({ status: 'aborted', activatedAt: new Date(), revealedAt: null })).toBe(
      true,
    );
    expect(
      isAwaitingReveal({ status: 'revealed', activatedAt: new Date(), revealedAt: new Date() }),
    ).toBe(false);
    expect(isAwaitingReveal({ ...base, status: 'active' })).toBe(false);
  });

  it('accepts observations while active and until the reveal', () => {
    expect(acceptsObservations({ ...base, status: 'active' })).toBe(true);
    expect(acceptsObservations({ ...base, status: 'briefed' })).toBe(false);
    expect(acceptsObservations({ ...base, status: 'planned' })).toBe(false);
  });
});

describe('briefing', () => {
  const view = buildBriefing({
    roleId: 'r1',
    status: 'briefed',
    revision: 1,
    trial: { number: 7, title: 'Build sprint' },
    team: { name: 'Team A' },
    scenario: { title: 'Urgent Token Request', technique: 'social_engineering' },
    objective: 'Ask for the sandbox key.',
    sandboxAssets: 'JVLN-SANDBOX-7Q4M-K2XD-93PA',
    guardrails: STANDARD_GUARDRAILS,
    triggers: [],
  });

  it('always carries the guardrails and the stop-word protocol', () => {
    expect(view.guardrails).toBe(STANDARD_GUARDRAILS);
    expect(view.stopWord).toBe(STOP_WORD);
    expect(view.stopProtocol).toBe(STOP_PROTOCOL);
    const text = renderBriefingText(view);
    expect(text).toContain('GUARDRAILS');
    expect(text).toContain(STANDARD_GUARDRAILS);
    expect(text).toContain(`STOP WORD: ${STOP_WORD}`);
    expect(text).toContain('Stand by until staff marks the exercise ACTIVE');
    expect(view.exerciseActive).toBe(false);
  });

  it('renders triggers when present', () => {
    const withTrigger = buildBriefing({
      ...view,
      status: 'active',
      triggers: [
        {
          id: 't1',
          label: 'Token ask',
          description: 'Ask in the team channel.',
          plannedFor: new Date('2026-03-01T13:00:00Z'),
          firedAt: null,
        },
      ],
    });
    expect(renderBriefingText(withTrigger)).toContain(
      '- Token ask (planned 2026-03-01T13:00:00.000Z)',
    );
    expect(withTrigger.exerciseActive).toBe(true);
  });
});

describe('debrief', () => {
  it('aggregates outcomes and never lists participants', () => {
    const view = buildDebrief({
      roleId: 'r1',
      trial: { number: 7, title: 'Build sprint' },
      team: { name: 'Team A' },
      scenario: { title: 'Data Export Ask', technique: 'data_handling' },
      operative: { displayName: 'Nova' },
      securityCultureScore: 8,
      outcomes: countOutcomes(['reported', 'resisted', 'resisted']),
      debrief: 'The team refused the export and escalated to staff within minutes.',
      stoppedEarly: false,
    });
    const text = renderDebriefText(view);
    expect(text).toContain('EXERCISE REVEALED — TRIAL #7 — Team A');
    expect(text).toContain('SECURITY CULTURE — 8/10');
    expect(text).toContain('OPERATIVE — Nova');
    expect(text).toContain('Resisted 2 · Reported 1');
    expect(text).not.toContain('stopped early');
    expect(formatOutcomeCounts(countOutcomes([]))).toBe('No observations recorded');
  });
});

describe('capability invariants', () => {
  it('everyone who can read the audit log can also manage adversarial roles (audit entries never leak)', () => {
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      if (caps.includes('canViewAuditLogs'))
        expect(caps.includes('canManageAdversarial'), role).toBe(true);
    }
  });

  it('only core and founder hold adversarial capabilities', () => {
    for (const [role, caps] of Object.entries(ROLE_CAPABILITIES)) {
      const holds =
        caps.includes('canManageAdversarial') || caps.includes('canAuthorizeAdversarial');
      expect(holds, role).toBe(role === 'core' || role === 'founder');
    }
  });
});
