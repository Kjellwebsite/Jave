import { describe, expect, it } from 'vitest';
import { canonicalJson, payloadHash } from './proposals.service';
import { redactForAI } from './redaction';
import {
  extractJsonObject,
  MODEL_SUGGESTED_LABEL,
  parseAnnouncementDraft,
  parseResearchAnswer,
  parseTaskDraft,
} from './structured-output';
import { nextUtcMidnight, startOfUtcDay } from './ledger';

describe('redactForAI', () => {
  const secrets = [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    'ghp_' + 'a'.repeat(36),
    'AKIAIOSFODNN7EXAMPLE',
    'xoxb-1234567890-abcdefghij',
    'AIza' + 'b'.repeat(35),
    'sk_live_' + 'c'.repeat(24),
    'glpat-' + 'd'.repeat(20),
    'hf_' + 'e'.repeat(34),
    'MTA' + 'x'.repeat(21) + '.GhIjKl.' + 'y'.repeat(27),
  ];

  it.each(secrets)('removes %s', (secret) => {
    const out = redactForAI(`my key is ${secret} ok`);
    expect(out.text).not.toContain(secret);
    expect(out.redacted).toBe(true);
  });

  it('removes labelled values, URL credentials and whole private keys', () => {
    const text = [
      'password: hunter22',
      'api_key="abcd1234efgh"',
      'postgres://jave:s3cret-pass@db.internal:5432/jave',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const out = redactForAI(text).text;
    for (const leaked of ['hunter22', 'abcd1234efgh', 's3cret-pass', 'MIIEpAIBAAKCAQEA']) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('password: [REDACTED]');
    expect(out).toContain('postgres://[REDACTED]@db.internal:5432/jave');
  });

  it('leaves ordinary text alone', () => {
    const text = 'The password policy requires 12 characters. See https://example.com/a?b=c.';
    expect(redactForAI(text)).toEqual({ text, redacted: false });
  });
});

describe('structured output', () => {
  it('extracts JSON from fenced or chatty output', () => {
    expect(extractJsonObject('Here:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('no json')).toBeNull();
    expect(extractJsonObject('{broken')).toBeNull();
  });

  it('parses a research brief and labels every source as unverified', () => {
    const parsed = parseResearchAnswer(
      JSON.stringify({
        answer: 'Sleep consolidates memory.',
        keyPoints: ['Slow-wave sleep matters', 42, '', 'REM too'],
        caveats: 'Mostly observational.',
        suggestedSources: [
          { title: 'Walker 2017', url: 'https://doi.org/10.1000/x', note: 'Review' },
          { title: 'Evil', url: 'javascript:alert(1)' },
          { title: 'No url' },
          { nope: true },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      answer: 'Sleep consolidates memory.',
      keyPoints: ['Slow-wave sleep matters', 'REM too'],
      caveats: 'Mostly observational.',
      structured: true,
    });
    expect(parsed.suggestedSources).toEqual([
      {
        title: 'Walker 2017',
        url: 'https://doi.org/10.1000/x',
        note: 'Review',
        verified: false,
        label: MODEL_SUGGESTED_LABEL,
      },
      { title: 'Evil', url: null, note: '', verified: false, label: MODEL_SUGGESTED_LABEL },
      { title: 'No url', url: null, note: '', verified: false, label: MODEL_SUGGESTED_LABEL },
    ]);
  });

  it('falls back to plain text when the model ignores the format', () => {
    expect(parseResearchAnswer('Just prose.')).toEqual({
      answer: 'Just prose.',
      keyPoints: [],
      caveats: '',
      suggestedSources: [],
      structured: false,
    });
  });

  it('BREAK: caps hostile sizes', () => {
    const parsed = parseResearchAnswer(
      JSON.stringify({
        answer: 'a'.repeat(50_000),
        keyPoints: Array.from({ length: 100 }, () => 'p'.repeat(5000)),
        suggestedSources: Array.from({ length: 100 }, (_, i) => ({ title: `t${i}` })),
      }),
    );
    expect(parsed.answer.length).toBeLessThanOrEqual(8000);
    expect(parsed.keyPoints).toHaveLength(8);
    expect(parsed.keyPoints[0]!.length).toBeLessThanOrEqual(500);
    expect(parsed.suggestedSources).toHaveLength(6);
  });

  it('parses announcement drafts with a neutral fallback', () => {
    expect(parseAnnouncementDraft('{"title":"TRIALS OPEN","body":"Apply now."}')).toEqual({
      title: 'TRIALS OPEN',
      body: 'Apply now.',
    });
    expect(parseAnnouncementDraft('Plain draft text')).toEqual({
      title: 'ANNOUNCEMENT',
      body: 'Plain draft text',
    });
  });

  it('parses mission drafts, falling back to a safe type and a plain-text brief', () => {
    expect(
      parseTaskDraft('```json\n{"title":"Ship a CLI","brief":"Build it.","type":"build"}\n```'),
    ).toEqual({ title: 'Ship a CLI', brief: 'Build it.', type: 'build' });
    expect(parseTaskDraft('{"title":"T","brief":"B","type":"ban_everyone"}').type).toBe(
      'individual',
    );
    expect(parseTaskDraft('Just write a parser.')).toEqual({
      title: 'Untitled mission',
      brief: 'Just write a parser.',
      type: 'individual',
    });
    const huge = parseTaskDraft(
      JSON.stringify({ title: 't'.repeat(500), brief: 'b'.repeat(9000) }),
    );
    expect(huge.title.length).toBeLessThanOrEqual(120);
    expect(huge.brief.length).toBeLessThanOrEqual(4000);
  });
});

describe('proposal payload hashing', () => {
  it('is independent of key order and ignores undefined', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: null }], u: undefined })).toBe(
      '{"a":[2,{"c":null,"d":1}],"b":1}',
    );
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
    expect(payloadHash({ a: 1 })).not.toBe(payloadHash({ a: 2 }));
  });
});

describe('UTC day boundaries', () => {
  it('computes the day window', () => {
    const now = new Date('2026-03-01T23:59:59.999Z');
    expect(startOfUtcDay(now).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(nextUtcMidnight(now).toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });
});
