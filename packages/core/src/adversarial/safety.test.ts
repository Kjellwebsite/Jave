import { describe, expect, it } from 'vitest';
import {
  assertSafe,
  canonicalize,
  inspectText,
  isSandboxHost,
  MAX_SAFETY_TEXT_LENGTH,
  missingProhibitions,
  sanitizeStopText,
  STANDARD_GUARDRAILS,
  STANDARD_PROHIBITIONS,
  type SafetyRule,
} from './safety';
import { scenarioSafetyFields } from './scenarios.service';
import { STARTER_SCENARIOS } from './starter-scenarios';

type Kind = 'content' | 'guardrails' | 'report';

function rules(text: string, kind: Kind = 'content'): SafetyRule[] {
  return inspectText('field', text, kind).map((issue) => issue.rule);
}

/** Synthetic high-entropy run: not a real credential, but shaped like one. */
const SYNTHETIC_HEX = 'deadbeef'.repeat(5);

describe('safety validator — secrets (generic shapes)', () => {
  it.each([
    ['long hex run', `hash ${SYNTHETIC_HEX}`],
    ['key/value assignment', 'secret=placeholder-value-123'],
  ])('BREAK: rejects %s in every kind', (_label, text) => {
    for (const kind of ['content', 'guardrails', 'report'] as const) {
      expect(rules(text, kind)).toContain('secret');
    }
  });

  it('never echoes the detected value in issues or errors', () => {
    const text = `send ${SYNTHETIC_HEX}`;
    for (const issue of inspectText('objective', text, 'content'))
      expect(issue.message).not.toContain(SYNTHETIC_HEX);
    expect(() => assertSafe([{ field: 'objective', text, kind: 'content' }])).toThrow(
      /Safety check failed/,
    );
    try {
      assertSafe([{ field: 'objective', text, kind: 'content' }]);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(SYNTHETIC_HEX);
    }
  });

  it('BREAK: never echoes a secret-looking value embedded in a host name', () => {
    const issues = inspectText(
      'objective',
      `open https://${SYNTHETIC_HEX}.outside-host.com`,
      'content',
    );
    expect(issues.map((i) => i.rule)).toEqual(expect.arrayContaining(['secret', 'external_link']));
    for (const issue of issues) expect(issue.message).not.toContain(SYNTHETIC_HEX);
  });

  it.each([
    'Ask for the sandbox deploy key JVLN-SANDBOX-7Q4M-K2XD-93PA.',
    'Ask the team to paste the fictional key (JVLN-SANDBOX-…) into chat.',
    'The sandbox key: JVLN-SANDBOX-AB12-CD34',
  ])('allows fictional sandbox keys: %s', (text) => {
    expect(rules(text)).not.toContain('secret');
  });
});

describe('safety validator — links and hosts', () => {
  it.each([
    ['external https', 'Open https://outside-host.com/page'],
    ['bare external domain', 'upload it to outside-host.io'],
    ['userinfo trick', 'http://example.com@outside-host.com/x'],
    ['suffix lookalike', 'go to example.com.outside-host.net'],
    ['hyphen lookalike', 'go to evil-example.com'],
    ['defanged link', 'hxxps://outside-host[.]com'],
    ['defanged dot word', 'outside-host[dot]com'],
    ['full-width characters', 'ｏｕｔｓｉｄｅ．ｃｏｍ'],
    ['ideographic dot', 'outside。com'],
    ['script scheme', 'javascript:alert(1)'],
    ['ftp scheme to a sandbox host', 'ftp://files.jvln.test/x'],
    ['email at an external domain', 'mail it to someone@outside-host.com'],
    ['discord invite', 'join discord.gg/abc'],
  ])('BREAK: rejects %s', (_label, text) => {
    expect(rules(text)).toContain('external_link');
    expect(rules(text, 'report')).toContain('external_link');
  });

  it.each([
    'Use https://drive.jvln.test/personal',
    'Repository at git.jvln.test',
    'See https://example.org/brief and example.net',
    'Contact ops@jvln.test',
    'Export customers.csv and notes.json',
    'Built with Node.js',
    'e.g. the U.S. format',
    'Version 3.5 at 10 a.m.',
  ])('allows sandbox hosts and ordinary prose: %s', (text) => {
    expect(rules(text)).not.toContain('external_link');
  });

  it('matches sandbox hosts exactly or as subdomains', () => {
    expect(isSandboxHost('jvln.test')).toBe(true);
    expect(isSandboxHost('git.jvln.test')).toBe(true);
    expect(isSandboxHost('GIT.JVLN.TEST.')).toBe(true);
    expect(isSandboxHost('jvln.test.outside.com')).toBe(false);
    expect(isSandboxHost('notjvln.test')).toBe(false);
  });
});

describe('safety validator — content rules', () => {
  it.each([
    'Ask for their password',
    'Request the 2FA code',
    'ask for a one-time code',
    'Get their OTP',
    'Collect the SSN',
    'Ask for bank details',
    'Ask for their home address',
    'Ask for their real account name',
    'Ask for their phone number',
    'Ask for the date of birth',
    'Ask for the recovery phrase',
  ])('BREAK: rejects personal-data requests: %s', (text) => {
    expect(rules(text)).toContain('personal_data');
  });

  it.each([
    'Change the production database',
    'Log into their school account',
    'Contact people outside the trial',
    'Message their friends',
    'Ping @everyone',
    'Mention <@123456789012345678>',
    'Connect to 10.0.0.1.',
    'Run it against localhost',
    'Use their Discord account',
    'Deploy malware',
    'Target the real customers',
    'Use a third-party service',
  ])('BREAK: rejects out-of-scope targets: %s', (text) => {
    expect(rules(text)).toContain('out_of_scope');
  });

  it('keyword rules apply to content only (prohibitions must be able to name forbidden things)', () => {
    const prohibition = 'Never request passwords or 2FA codes from anyone outside the trial.';
    expect(rules(prohibition, 'content')).toEqual(
      expect.arrayContaining(['personal_data', 'out_of_scope']),
    );
    expect(rules(prohibition, 'report')).toEqual([]);
  });

  it('BREAK: sees through zero-width splitting and flags the hidden characters', () => {
    const split = 'ask for their pass​word';
    expect(rules(split)).toEqual(expect.arrayContaining(['hidden_characters', 'personal_data']));
  });

  it.each([
    ['bidi override', 'safe text ‮etirw'],
    ['control character', 'line\u0007bell'],
    ['BOM', '﻿start'],
  ])('BREAK: rejects %s', (_label, text) => {
    expect(rules(text, 'report')).toContain('hidden_characters');
  });

  it('BREAK: rejects oversized text without scanning it', () => {
    const huge = 'a'.repeat(MAX_SAFETY_TEXT_LENGTH + 1);
    expect(rules(huge)).toEqual(['too_long']);
  });

  it('BREAK: stays fast on pathological input', () => {
    const inputs = [
      'a.'.repeat(4_000) + '_',
      'a-'.repeat(4_900),
      '@a.'.repeat(3_000),
      'x'.repeat(MAX_SAFETY_TEXT_LENGTH),
    ];
    const started = performance.now();
    for (const input of inputs) inspectText('field', input, 'content');
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('BREAK: long whitespace and dot runs stay linear in every kind (regression: quadratic normalization)', () => {
    const tail = MAX_SAFETY_TEXT_LENGTH - 1;
    const inputs = [
      `${' '.repeat(tail)}x`,
      `${'\t\n '.repeat(tail / 3)}x`,
      `${'　'.repeat(tail)}x`,
      `[${' '.repeat(tail - 1)}x`,
      `${'.'.repeat(tail)}x`,
      `${'. '.repeat(tail / 2)}x`,
      `password${' '.repeat(tail - 10)}:x`,
    ];
    const started = performance.now();
    for (const input of inputs) {
      for (const kind of ['content', 'guardrails', 'report'] as const)
        inspectText('field', input, kind);
      sanitizeStopText(input, 500);
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('safety validator — guardrails', () => {
  it('accepts the standard guardrails and additions', () => {
    expect(rules(STANDARD_GUARDRAILS, 'guardrails')).toEqual([]);
    expect(rules(`${STANDARD_GUARDRAILS}\n- Ask at most twice.`, 'guardrails')).toEqual([]);
  });

  it('BREAK: requires every standard prohibition', () => {
    const without = STANDARD_PROHIBITIONS.slice(1).join('\n');
    expect(missingProhibitions(without)).toEqual([STANDARD_PROHIBITIONS[0]]);
    expect(rules(without, 'guardrails')).toEqual(['missing_prohibition']);
    expect(missingProhibitions('Be nice.')).toHaveLength(STANDARD_PROHIBITIONS.length);
  });

  it('tolerates case, whitespace and quote differences', () => {
    const reflowed = STANDARD_PROHIBITIONS.map((p) => p.toUpperCase().replace(/ /g, '   ')).join(
      '\n',
    );
    expect(missingProhibitions(reflowed)).toEqual([]);
  });

  it('BREAK: guardrails still cannot carry links', () => {
    expect(
      rules(`${STANDARD_GUARDRAILS}\n- Details at https://outside-host.com`, 'guardrails'),
    ).toEqual(['external_link']);
  });
});

describe('starter scenarios', () => {
  it.each(STARTER_SCENARIOS.map((s) => [s.key, s] as const))(
    '%s passes the validator',
    (_key, s) => {
      expect(() => assertSafe(scenarioSafetyFields(s))).not.toThrow();
    },
  );

  it('covers every technique with unique keys', () => {
    expect(new Set(STARTER_SCENARIOS.map((s) => s.technique)).size).toBe(5);
    expect(new Set(STARTER_SCENARIOS.map((s) => s.key)).size).toBe(STARTER_SCENARIOS.length);
  });
});

describe('helpers', () => {
  it('canonicalizes full-width text and defanged links', () => {
    expect(canonicalize('ｈｅｌｌｏ   world')).toBe('hello world');
    expect(canonicalize('hxxp://a[.]b')).toBe('http://a.b');
  });

  it('sanitizes stop texts instead of rejecting them', () => {
    const cleaned = sanitizeStopText(`stop now ‮ ${SYNTHETIC_HEX}`, 500);
    expect(cleaned).not.toContain(SYNTHETIC_HEX);
    expect(cleaned).not.toContain('‮');
    expect(cleaned.startsWith('stop now')).toBe(true);
    expect(sanitizeStopText('x'.repeat(900), 100)).toHaveLength(100);
  });
});
