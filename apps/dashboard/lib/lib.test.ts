import { describe, expect, it } from 'vitest';
import { issuesToFieldErrors } from './action-state';
import { formatAuditContext, formatAuditTarget, MAX_CONTEXT_CHARS } from './audit-view';
import { buildContentSecurityPolicy, createNonce } from './csp';
import { referenceFromDigest } from './error-reference';
import {
  formBoolean,
  formEnum,
  formOptional,
  formString,
  MAX_FORM_FIELD_LENGTH,
} from './form-data';
import { isActivePath, NAV_GROUPS, navContext, visibleNav } from './nav';
import { clientIp, isSameOriginRequest } from './request-security';
import { isPublicPath, safeNextPath } from './routes';
import { safeExternalUrl, safeInternalPath } from './safe-url';
import { firstParam, offsetParam, toQueryString } from './search-params';
import { formatDate, formatRelative, formatTimestamp, minutesToTime, timeToMinutes } from './time';

function headers(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name: string) => map.get(name.toLowerCase()) ?? null };
}

describe('routes', () => {
  it('knows which paths are public', () => {
    for (const path of [
      '/',
      '/login',
      '/api/health',
      '/p/mara',
      '/api/auth/discord',
      '/api/auth/discord/callback',
    ]) {
      expect(isPublicPath(path), path).toBe(true);
    }
    for (const path of ['/overview', '/members', '/settings', '/api/other', '/login/extra', '/p']) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it('keeps same-origin next paths', () => {
    expect(safeNextPath('/members?role=core#top')).toBe('/members?role=core#top');
    expect(safeNextPath(undefined)).toBe('/overview');
  });

  it('BREAK: rejects every off-site or odd redirect target', () => {
    for (const target of [
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      'https://evil.example/',
      'javascript:alert(1)',
      '/\tevil',
      '/%0d%0aSet-Cookie:x',
      'members',
      '/api/auth/discord',
      '/login',
      `/${'a'.repeat(600)}`,
    ]) {
      const result = safeNextPath(target);
      expect(result === '/overview' || result.startsWith('/%0d'), target).toBe(true);
      expect(result.startsWith('//')).toBe(false);
    }
  });
});

describe('same-origin check (CSRF)', () => {
  const trusted = ['https://jave.example'];

  it('accepts the public origin and the addressed host', () => {
    expect(isSameOriginRequest(headers({ origin: 'https://jave.example' }), trusted)).toBe(true);
    expect(
      isSameOriginRequest(
        headers({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
        trusted,
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        headers({
          origin: 'https://internal.example',
          'x-forwarded-host': 'internal.example, proxy',
        }),
        trusted,
      ),
    ).toBe(true);
  });

  it('accepts a browser-asserted same-origin request without an Origin header', () => {
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'same-origin' }), trusted)).toBe(true);
  });

  it('BREAK: rejects foreign, opaque, malformed and unasserted requests', () => {
    expect(
      isSameOriginRequest(
        headers({ origin: 'https://evil.example', host: 'jave.example' }),
        trusted,
      ),
    ).toBe(false);
    expect(isSameOriginRequest(headers({ origin: 'null', host: 'jave.example' }), trusted)).toBe(
      false,
    );
    expect(
      isSameOriginRequest(headers({ origin: 'not a url', host: 'jave.example' }), trusted),
    ).toBe(false);
    expect(
      isSameOriginRequest(headers({ origin: 'ftp://jave.example', host: 'jave.example' }), trusted),
    ).toBe(false);
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'cross-site' }), trusted)).toBe(false);
    expect(isSameOriginRequest(headers({}), trusted)).toBe(false);
    expect(
      isSameOriginRequest(headers({ origin: 'https://jave.example.evil.example' }), trusted),
    ).toBe(false);
  });

  it('takes the proxy-appended (right-most) forwarded address', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientIp(headers({ 'x-real-ip': '198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientIp(headers({}))).toBe('unknown');
    expect(clientIp(headers({ 'x-forwarded-for': 'x'.repeat(500) })).length).toBeLessThanOrEqual(
      64,
    );
  });
});

describe('content security policy', () => {
  it('uses a nonce and strict-dynamic, and never unsafe-eval outside development', () => {
    const nonce = createNonce();
    const csp = buildContentSecurityPolicy({
      nonce,
      development: false,
      upgradeInsecureRequests: true,
    });
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('adds only what next dev needs in development', () => {
    const csp = buildContentSecurityPolicy({
      nonce: 'n',
      development: true,
      upgradeInsecureRequests: false,
    });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('creates unpredictable base64 nonces', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => createNonce()));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('navigation', () => {
  it('shows each entry only with its capability and drops empty groups', () => {
    const member = visibleNav(NAV_GROUPS, ['canViewMembers']);
    expect(member.map((group) => group.label)).toEqual(['OVERVIEW', 'PEOPLE']);
    const founder = visibleNav(NAV_GROUPS, [
      'canViewMembers',
      'canViewAuditLogs',
      'canViewSettings',
    ]);
    expect(founder.flatMap((group) => group.items.map((item) => item.href))).toEqual([
      '/overview',
      '/members',
      '/ranking',
      '/audit',
      '/settings',
    ]);
    expect(
      visibleNav(NAV_GROUPS, []).flatMap((group) => group.items.map((item) => item.href)),
    ).toEqual(['/overview']);
  });

  it('resolves page context from nested paths', () => {
    expect(navContext('/members/123')).toEqual({ group: 'PEOPLE', label: 'Members' });
    expect(navContext('/notifications')).toEqual({ group: 'ACCOUNT', label: 'Notifications' });
    expect(navContext('/nowhere')).toBeNull();
    expect(isActivePath('/membership', '/members')).toBe(false);
  });
});

describe('time', () => {
  const instant = new Date('2026-09-24T22:30:00.000Z');

  it('formats in the viewer time zone', () => {
    expect(formatTimestamp(instant, 'UTC')).toBe('2026-09-24 22:30');
    expect(formatTimestamp(instant, 'Asia/Tokyo')).toBe('2026-09-25 07:30');
    expect(formatDate(instant, 'America/Los_Angeles')).toBe('2026-09-24');
    expect(formatTimestamp(instant, 'Not/AZone')).toBe('2026-09-24 22:30');
  });

  it('formats relative times', () => {
    const at = (ms: number) => new Date(instant.getTime() - ms);
    expect(formatRelative(at(10_000), instant)).toBe('just now');
    expect(formatRelative(at(5 * 60_000), instant)).toBe('5m ago');
    expect(formatRelative(at(3 * 3_600_000), instant)).toBe('3h ago');
    expect(formatRelative(at(2 * 86_400_000), instant)).toBe('2d ago');
    expect(formatRelative(at(40 * 86_400_000), instant)).toBe('2026-08-15');
  });

  it('converts quiet-hour times', () => {
    expect(minutesToTime(1320)).toBe('22:00');
    expect(minutesToTime(0)).toBe('00:00');
    expect(timeToMinutes('07:05')).toBe(425);
    for (const bad of ['24:00', '7:00', '12:60', '', 'noon'])
      expect(timeToMinutes(bad), bad).toBeNull();
  });
});

describe('error references', () => {
  it('derive a stable E-XXXXXXXX reference from a digest', () => {
    const reference = referenceFromDigest('4110945878');
    expect(reference).toMatch(/^E-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(referenceFromDigest('4110945878')).toBe(reference);
    expect(referenceFromDigest('4110945879')).not.toBe(reference);
  });
});

describe('forms and query strings', () => {
  it('reads form fields defensively', () => {
    const data = new FormData();
    data.set('name', '  Mara  ');
    data.set('empty', '   ');
    data.set('flag', 'on');
    data.set('long', 'x'.repeat(MAX_FORM_FIELD_LENGTH + 50));
    data.set('file', new Blob(['binary']));
    data.set('role', 'core');
    expect(formString(data, 'name')).toBe('  Mara  ');
    expect(formOptional(data, 'empty')).toBeUndefined();
    expect(formBoolean(data, 'flag')).toBe(true);
    expect(formBoolean(data, 'missing')).toBe(false);
    expect(formString(data, 'long')).toHaveLength(MAX_FORM_FIELD_LENGTH);
    expect(formString(data, 'file')).toBe('');
    expect(formEnum(data, 'role', ['core', 'member'] as const)).toBe('core');
    expect(formEnum(data, 'name', ['core'] as const)).toBeUndefined();
  });

  it('maps validation issues to field names', () => {
    expect(
      issuesToFieldErrors(
        [
          { path: 'links.allowlist.2', message: 'bad domain' },
          { path: 'reason', message: 'Give a reason' },
          { path: 'reason', message: 'second' },
        ],
        ['links.allowlist'],
      ),
    ).toEqual({ 'links.allowlist': 'bad domain', reason: 'Give a reason' });
  });

  it('builds and reads query strings', () => {
    expect(toQueryString({ q: 'mara', role: undefined, offset: 0, empty: '' })).toBe(
      '?q=mara&offset=0',
    );
    expect(toQueryString({})).toBe('');
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('x'.repeat(1000))).toHaveLength(256);
    expect(offsetParam('50')).toBe(50);
    for (const bad of ['-1', '1.5', 'abc', undefined]) expect(offsetParam(bad)).toBe(0);
    expect(offsetParam('99999999')).toBe(100_000);
  });
});

describe('URL safety', () => {
  it('allows only absolute http(s) external links', () => {
    expect(safeExternalUrl('https://example.org/a')).toBe('https://example.org/a');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      '/relative',
      'vbscript:x',
      null,
      '',
    ]) {
      expect(safeExternalUrl(bad), String(bad)).toBeNull();
    }
  });

  it('allows only same-origin internal paths', () => {
    expect(safeInternalPath('/members?x=1')).toBe('/members?x=1');
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'members', null]) {
      expect(safeInternalPath(bad), String(bad)).toBeNull();
    }
  });
});

describe('audit context viewer', () => {
  it('pretty-prints and truncates without ever producing markup', () => {
    expect(formatAuditContext({})).toBeNull();
    const text = formatAuditContext({ note: '<script>alert(1)</script>' });
    expect(text).toContain('"note": "<script>alert(1)</script>"');
    const long = formatAuditContext({ blob: 'x'.repeat(MAX_CONTEXT_CHARS * 2) })!;
    expect(long.length).toBeLessThan(MAX_CONTEXT_CHARS + 20);
    expect(long.endsWith('[truncated]')).toBe(true);
    expect(formatAuditTarget('member', '5b2c1f3a-aaaa-bbbb-cccc-000000000000')).toBe(
      'member:5b2c1f3a…',
    );
    expect(formatAuditTarget(null, null)).toBe('—');
  });
});
