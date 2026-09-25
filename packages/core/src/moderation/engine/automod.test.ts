import { describe, expect, it } from 'vitest';
import { settingsSchemas } from '../../settings/schemas';
import { type AutomodInput, evaluateMessage, type ModerationSettings } from './automod';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const SECOND = 1000;

function settings(patch: Record<string, unknown> = {}): ModerationSettings {
  return settingsSchemas.moderation.parse(patch);
}

function input(overrides: Partial<AutomodInput> = {}): AutomodInput {
  return {
    content: 'hello there',
    mentionCount: 0,
    authorRoles: ['member'],
    accountAgeDays: 400,
    recent: [],
    now: NOW,
    settings: settings(),
    ownInviteCodes: [],
    ...overrides,
  };
}

const keys = (overrides: Partial<AutomodInput>) =>
  evaluateMessage(input(overrides)).signals.map((s) => s.key);

const ago = (seconds: number) => new Date(NOW.getTime() - seconds * SECOND);

describe('automod engine', () => {
  it('passes clean messages', () => {
    expect(evaluateMessage(input())).toEqual({
      signals: [],
      modifiers: [],
      riskScore: 0,
      action: 'none',
      trigger: null,
      exempt: false,
    });
  });

  describe('invites', () => {
    it('deletes a foreign invite', () => {
      const result = evaluateMessage(input({ content: 'join discord.gg/abc123' }));
      expect(result.signals.map((s) => s.key)).toEqual(['foreign_invite']);
      expect(result.riskScore).toBe(45);
      expect(result.action).toBe('delete');
      expect(result.trigger).toBe('foreign_invite');
      expect(result.signals[0]?.detail).toBe('discord.gg/abc123');
    });

    it('allows this server’s own invite codes (exact, case-sensitive)', () => {
      expect(keys({ content: 'discord.gg/javelin', ownInviteCodes: ['javelin'] })).toEqual([]);
      expect(keys({ content: 'discord.gg/JAVELIN', ownInviteCodes: ['javelin'] })).toEqual([
        'foreign_invite',
      ]);
    });

    it('catches every host form', () => {
      for (const content of [
        'https://discord.com/invite/xyz',
        'discordapp.com/invite/xyz',
        'dsc.gg/xyz',
        'https://discord.gg/invite/xyz',
      ]) {
        expect(keys({ content }), content).toContain('foreign_invite');
      }
    });

    it('adds an evasion signal for obfuscated invites', () => {
      const result = evaluateMessage(input({ content: 'discord [.] gg / abc' }));
      expect(result.signals.map((s) => s.key)).toEqual(['foreign_invite', 'obfuscated_link']);
      expect(result.riskScore).toBe(59);
      expect(result.action).toBe('delete');
    });

    it('quarantines a lookalike-domain invite (phishing)', () => {
      const result = evaluateMessage(input({ content: 'claim nitro discоrd.gg/abc' }));
      expect(result.signals.map((s) => s.key).sort()).toEqual([
        'foreign_invite',
        'lookalike_domain',
        'obfuscated_link',
      ]);
      expect(result.riskScore).toBe(92);
      expect(result.action).toBe('quarantine');
      expect(result.trigger).toBe('blocked_link');
    });

    it('ignores invites when blockForeignInvites is off', () => {
      expect(
        keys({ content: 'discord.gg/abc', settings: settings({ blockForeignInvites: false }) }),
      ).toEqual([]);
    });
  });

  describe('links', () => {
    const deny = settings({ links: { mode: 'denylist', denylist: ['evil.com'], allowlist: [] } });

    it('blocks denylisted domains including subdomains and userinfo tricks', () => {
      expect(keys({ content: 'https://evil.com/x', settings: deny })).toEqual(['blocked_link']);
      expect(keys({ content: 'https://login.evil.com', settings: deny })).toEqual(['blocked_link']);
      expect(keys({ content: 'https://discord.com@evil.com/', settings: deny })).toEqual([
        'blocked_link',
      ]);
      expect(keys({ content: 'https://notevil.com', settings: deny })).toEqual([]);
    });

    it('escalates defanged denylisted links to a timeout', () => {
      const result = evaluateMessage(
        input({ content: 'check hxxps://evil[.]com/login', settings: deny }),
      );
      expect(result.signals.map((s) => s.key)).toEqual(['blocked_link', 'obfuscated_link']);
      expect(result.riskScore).toBe(63);
      expect(result.action).toBe('timeout');
    });

    it('does not punish defanged links that are otherwise allowed', () => {
      expect(keys({ content: 'IOC: hxxp://malware[.]example/payload', settings: deny })).toEqual(
        [],
      );
    });

    it('allowlist mode: exact domains, wildcards, first-party Discord', () => {
      const allow = settings({
        links: { mode: 'allowlist', allowlist: ['example.com', '*.github.io'], denylist: [] },
      });
      expect(keys({ content: 'https://example.com/x', settings: allow })).toEqual([]);
      expect(keys({ content: 'https://me.github.io', settings: allow })).toEqual([]);
      expect(keys({ content: 'https://cdn.discordapp.com/a/b/c.png', settings: allow })).toEqual(
        [],
      );
      expect(keys({ content: 'https://docs.example.com', settings: allow })).toEqual([
        'unlisted_link',
      ]);
      expect(keys({ content: 'google.com', settings: allow })).toEqual(['unlisted_link']);
      expect(keys({ content: 'open index.ts and readme.md', settings: allow })).toEqual([]);
    });

    it('allowlist mode still honours the denylist', () => {
      const both = settings({
        links: { mode: 'allowlist', allowlist: ['*.example.com'], denylist: ['bad.example.com'] },
      });
      expect(keys({ content: 'https://bad.example.com', settings: both })).toEqual([
        'blocked_link',
      ]);
    });

    it('mode off disables link rules but not invite rules', () => {
      const off = settings({ links: { mode: 'off', denylist: ['evil.com'], allowlist: [] } });
      expect(keys({ content: 'https://evil.com https://dlscord.com', settings: off })).toEqual([]);
      expect(keys({ content: 'discord.gg/abc', settings: off })).toEqual(['foreign_invite']);
    });

    it('times out lookalike phishing links on their own', () => {
      const result = evaluateMessage(input({ content: 'free nitro https://dlscord.gift/n' }));
      expect(result.signals.map((s) => s.key)).toEqual(['lookalike_domain']);
      expect(result.action).toBe('timeout');
      expect(keys({ content: 'https://discord.com/channels/1/2' })).toEqual([]);
    });

    it('treats allowlisted domains as protected from lookalikes', () => {
      const allow = settings({
        links: { mode: 'allowlist', allowlist: ['javelin.org'], denylist: [] },
      });
      expect(keys({ content: 'https://jave1in.org/login', settings: allow })).toEqual([
        'lookalike_domain',
      ]);
    });
  });

  describe('rate and duplicates', () => {
    const burst = (count: number, spacingSeconds: number, prefix = 'msg') =>
      Array.from({ length: count }, (_, i) => ({
        content: `${prefix} ${i}`,
        at: ago((i + 1) * spacingSeconds),
      }));

    it('flags more than maxMessages in the window', () => {
      expect(keys({ recent: burst(6, 1) })).toEqual([]);
      const result = evaluateMessage(input({ recent: burst(7, 1) }));
      expect(result.signals.map((s) => s.key)).toEqual(['spam_rate']);
      expect(result.signals[0]?.detail).toBe('8 messages in 10s (limit 7)');
      expect(result.action).toBe('timeout');
    });

    it('uses the severe weight at twice the limit', () => {
      const result = evaluateMessage(input({ recent: burst(13, 0.5) }));
      expect(result.signals[0]?.weight).toBe(75);
    });

    it('ignores messages outside the window and from the future', () => {
      const outside = burst(10, 11);
      const future = Array.from({ length: 10 }, (_, i) => ({
        content: `f${i}`,
        at: new Date(NOW.getTime() + (i + 1) * SECOND),
      }));
      expect(keys({ recent: [...outside, ...future] })).toEqual([]);
    });

    it('window boundary: a message exactly windowSeconds old is outside', () => {
      const edge = [...burst(6, 1), { content: 'edge', at: ago(10) }];
      expect(keys({ recent: edge })).toEqual([]);
    });

    it('detects duplicates through case, spacing, zero-width and lookalikes', () => {
      const recent = [
        { content: 'BUY NOW', at: ago(40) },
        { content: 'b​uy   now', at: ago(30) },
        { content: 'bυy nоw!!', at: ago(20) },
      ];
      const result = evaluateMessage(input({ content: 'Buy now.', recent }));
      expect(result.signals.map((s) => s.key)).toEqual(['duplicate_content']);
      expect(result.action).toBe('delete');
      expect(keys({ content: 'Buy now.', recent: recent.slice(1) })).toEqual([]);
    });

    it('ignores short repeats and duplicates outside the duplicate window', () => {
      const shortRepeats = Array.from({ length: 6 }, (_, i) => ({
        content: 'ok',
        at: ago(i * 5 + 5),
      }));
      expect(keys({ content: 'ok', recent: shortRepeats })).toEqual([]);
      const old = Array.from({ length: 5 }, (_, i) => ({ content: 'buy now', at: ago(61 + i) }));
      expect(keys({ content: 'buy now', recent: old })).toEqual([]);
    });

    it('combines rate and duplicates, saturating below 100', () => {
      const recent = Array.from({ length: 8 }, (_, i) => ({
        content: 'spam spam',
        at: ago(i + 1),
      }));
      const result = evaluateMessage(input({ content: 'spam spam', recent }));
      expect(result.signals.map((s) => s.key)).toEqual(['spam_rate', 'duplicate_content']);
      // noisy-OR of 60 and 55 (severe duplicate): 100·(1 − 0.4·0.45) = 82
      expect(result.riskScore).toBe(82);
      expect(result.action).toBe('timeout');
    });
  });

  describe('mentions', () => {
    it('flags mention spam above the limit, severe at twice the limit', () => {
      expect(keys({ mentionCount: 6 })).toEqual([]);
      expect(evaluateMessage(input({ mentionCount: 7 })).action).toBe('delete');
      const severe = evaluateMessage(input({ mentionCount: 12 }));
      expect(severe.signals[0]?.weight).toBe(75);
      expect(severe.action).toBe('timeout');
    });

    it('flags @everyone / @here attempts, even split by zero-width characters', () => {
      expect(keys({ content: 'hey @everyone' })).toEqual(['everyone_mention']);
      expect(keys({ content: 'hey @​here' })).toEqual(['everyone_mention']);
      expect(keys({ content: 'x', mentionsEveryone: true })).toEqual(['everyone_mention']);
      expect(keys({ content: 'email me@everyonecorp' })).toEqual([]);
    });

    it('ignores nonsense mention counts', () => {
      expect(keys({ mentionCount: Number.NaN })).toEqual([]);
      expect(keys({ mentionCount: -5 })).toEqual([]);
    });
  });

  describe('exemptions', () => {
    it('never evaluates exempt roles', () => {
      const result = evaluateMessage(
        input({ content: 'discord.gg/abc @everyone', authorRoles: ['moderator'] }),
      );
      expect(result).toMatchObject({ action: 'none', riskScore: 0, exempt: true, signals: [] });
    });

    it('honours the caller exemption flag and custom exempt roles', () => {
      expect(evaluateMessage(input({ content: 'discord.gg/abc', exempt: true })).action).toBe(
        'none',
      );
      const custom = settings({ exemptRoles: ['verified'] });
      expect(
        evaluateMessage(
          input({ content: 'discord.gg/abc', authorRoles: ['verified'], settings: custom }),
        ).exempt,
      ).toBe(true);
      expect(
        evaluateMessage(
          input({ content: 'discord.gg/abc', authorRoles: ['moderator'], settings: custom }),
        ).action,
      ).toBe('delete');
    });

    it('does nothing when automod is disabled', () => {
      const off = settings({ automodEnabled: false });
      expect(evaluateMessage(input({ content: 'discord.gg/abc', settings: off })).action).toBe(
        'none',
      );
    });
  });

  describe('context modifiers', () => {
    it('amplify violations from new accounts and new members', () => {
      const newAccount = evaluateMessage(input({ content: 'discord.gg/abc', accountAgeDays: 0.5 }));
      expect(newAccount.modifiers.map((m) => m.key)).toEqual(['very_new_account']);
      expect(newAccount.riskScore).toBe(61);
      expect(newAccount.action).toBe('timeout');

      const both = evaluateMessage(
        input({ content: 'discord.gg/abc', accountAgeDays: 0.5, memberAgeMinutes: 5 }),
      );
      expect(both.riskScore).toBe(70);
    });

    it('caps the combined multiplier', () => {
      const all = evaluateMessage(
        input({
          content: 'discord.gg/abc',
          accountAgeDays: 0,
          memberAgeMinutes: 1,
          raidMode: true,
        }),
      );
      expect(all.modifiers).toHaveLength(3);
      expect(all.riskScore).toBe(72);
    });

    it('never create risk on their own', () => {
      const result = evaluateMessage(
        input({ accountAgeDays: 0, memberAgeMinutes: 1, raidMode: true }),
      );
      expect(result).toMatchObject({ riskScore: 0, action: 'none', modifiers: [] });
    });

    it('uses the configured new-account age', () => {
      const result = evaluateMessage(
        input({ content: 'discord.gg/abc', accountAgeDays: 10, newAccountDays: 14 }),
      );
      expect(result.modifiers.map((m) => m.key)).toEqual(['new_account']);
    });

    it('quarantines the classic raid-bot message', () => {
      const result = evaluateMessage(
        input({
          content: '@everyone FREE NITRO discord.gg/raid',
          mentionCount: 8,
          accountAgeDays: 0,
        }),
      );
      expect(result.riskScore).toBe(100);
      expect(result.action).toBe('quarantine');
    });

    it('respects the configured quarantine threshold', () => {
      const strict = settings({ quarantineRiskScore: 60 });
      expect(
        evaluateMessage(input({ content: 'hxxps://dlscord[.]com', settings: strict })).action,
      ).toBe('quarantine');
    });
  });

  describe('robustness', () => {
    it('BREAK: huge content and history evaluate quickly', () => {
      const content = `${'discord.gg/x '.repeat(3000)}${'a.'.repeat(20_000)}`;
      const recent = Array.from({ length: 1000 }, (_, i) => ({
        content: 'x'.repeat(8000),
        at: ago(i % 60),
      }));
      const started = performance.now();
      const result = evaluateMessage(input({ content, recent }));
      expect(performance.now() - started).toBeLessThan(2000);
      expect(result.action).not.toBe('none');
    });

    it('BREAK: invalid dates in history are ignored', () => {
      const recent = [{ content: 'a', at: new Date('invalid') }];
      expect(keys({ recent })).toEqual([]);
    });
  });
});
