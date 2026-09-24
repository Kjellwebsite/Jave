import { describe, expect, it } from 'vitest';
import {
  DISCORD_EMBED_DESCRIPTION_LIMIT,
  DISCORD_MESSAGE_LIMIT,
  sanitizeForDiscord,
  truncateForDiscord,
} from './discord-text';

const ZWSP = '\u200B';

describe('sanitizeForDiscord()', () => {
  it('neutralizes mass mentions in any case', () => {
    expect(sanitizeForDiscord('@everyone and @HERE and @everyones')).toBe(
      `@${ZWSP}everyone and @${ZWSP}HERE and @${ZWSP}everyones`,
    );
  });

  it('breaks user, role, channel and command mention syntax', () => {
    const out = sanitizeForDiscord(
      'hi <@123456789012345678> <@!123456789012345678> <@&123456789012345678> <#123456789012345678> </ban user:123456789012345678>',
    );
    expect(out).not.toMatch(/<@!?\d/);
    expect(out).not.toMatch(/<@&\d/);
    expect(out).not.toMatch(/<#\d/);
    expect(out).not.toMatch(/<\/ban user:\d/);
    expect(out).toContain('123456789012345678');
  });

  it('unmasks deceptive links', () => {
    expect(sanitizeForDiscord('[https://javelin.gg](https://evil.example/phish)')).toBe(
      'https://javelin.gg (<https://evil.example/phish>)',
    );
  });

  it('is idempotent', () => {
    const once = sanitizeForDiscord('@everyone <@123456789012345678>');
    expect(sanitizeForDiscord(once)).toBe(once);
  });

  it('caps to the message and embed limits with an ellipsis', () => {
    const long = 'a'.repeat(5000);
    const message = sanitizeForDiscord(long);
    expect(message).toHaveLength(DISCORD_MESSAGE_LIMIT);
    expect(message.endsWith('…')).toBe(true);
    expect(sanitizeForDiscord(long, DISCORD_EMBED_DESCRIPTION_LIMIT)).toHaveLength(
      DISCORD_EMBED_DESCRIPTION_LIMIT,
    );
    expect(sanitizeForDiscord('short')).toBe('short');
  });

  it('caps after neutralization so inserted characters cannot overflow the limit', () => {
    const out = sanitizeForDiscord('@everyone '.repeat(400));
    expect(out.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
  });

  it('never splits a surrogate pair when truncating', () => {
    const text = `${'a'.repeat(8)}😀😀`;
    const out = truncateForDiscord(text, 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out).toBe(`${'a'.repeat(8)}…`);
    expect(() => encodeURIComponent(out)).not.toThrow();
  });
});
