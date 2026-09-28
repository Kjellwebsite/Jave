import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, randomCode, safeEqual } from './crypto';
import { REDACTED, redact } from './redact';
import { snowflakeToDate, newErrorId, newRequestId } from './ids';
import { SlidingWindowCounter } from '../rate-limit/rate-limit';
import { runHealthChecks } from '../observability/health';

describe('kernel', () => {
  it('encrypts and decrypts secrets; tampering fails', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const sealed = encryptSecret('hunter2', key);
    expect(sealed).not.toContain('hunter2');
    expect(decryptSecret(sealed, key)).toBe('hunter2');
    const parts = sealed.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
  });

  it('BREAK: redacts Discord bot tokens for every id shape and JAVE signing secrets', () => {
    const tokenFor = (id: string) =>
      `${Buffer.from(id).toString('base64').replace(/=+$/, '')}.GhIjKl.${'a1B2c3D4e5'.repeat(4)}`;
    for (const id of [
      '123456789012345678',
      '456789012345678901',
      '812345678901234567',
      '9876543210987654321',
    ]) {
      const token = tokenFor(id);
      expect(redact({ note: `my bot token is ${token} thanks` }).note).toBe(
        `my bot token is ${REDACTED} thanks`,
      );
    }
    const secret = `whsec_${'Zx9_-'.repeat(9)}`;
    expect(redact(`signing with ${secret}`)).toBe(`signing with ${REDACTED}`);
  });

  it('redacts secrets by key and by value shape', () => {
    const out = redact({
      token: 'abc',
      nested: { apiKey: 'x', note: 'key sk-ant-REDACTEDREDACTEDREDACTED1234 here' },
      list: ['ghp_' + 'a'.repeat(36)],
      safe: 'hello',
    });
    expect(out.token).toBe(REDACTED);
    expect(out.nested.apiKey).toBe(REDACTED);
    expect(out.nested.note).toBe(`key ${REDACTED} here`);
    expect(out.list[0]).toBe(REDACTED);
    expect(out.safe).toBe('hello');
  });

  it('compares in constant time and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('generates readable codes and ids', () => {
    expect(randomCode(10)).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(newErrorId()).toMatch(/^E-[0-9A-Z]{8}$/);
    expect(newRequestId()).toMatch(/^req_/);
  });

  it('decodes snowflake timestamps', () => {
    expect(snowflakeToDate('175928847299117063').toISOString()).toBe('2016-04-30T11:18:25.796Z');
  });

  it('sliding window counts hits inside the window', () => {
    const counter = new SlidingWindowCounter(1000);
    expect(counter.hit('a', 0)).toBe(1);
    expect(counter.hit('a', 500)).toBe(2);
    expect(counter.hit('a', 1600)).toBe(1);
  });

  it('health checks time out and classify severity', async () => {
    const report = await runHealthChecks(
      [
        { name: 'db', critical: true, run: async () => ({ status: 'ok' }) },
        {
          name: 'slow',
          critical: false,
          run: () => new Promise((r) => setTimeout(() => r({ status: 'ok' }), 200)),
        },
      ],
      50,
    );
    expect(report.status).toBe('degraded');
    expect(report.checks.find((c) => c.name === 'slow')!.status).toBe('down');
  });
});
