import { describe, expect, it } from 'vitest';
import {
  deobfuscate,
  extractInvites,
  extractLinks,
  findDomainMatch,
  isInviteLink,
  lookalikeOf,
  matchesDomainPattern,
  PROTECTED_DOMAINS,
} from './links';
import { foldConfusables, normalizeForComparison, skeleton, stripInvisible } from './normalize';

const hosts = (text: string) => extractLinks(text).map((l) => l.host);
const codes = (text: string) => extractInvites(text).map((i) => `${i.host}/${i.code}`);

describe('normalize', () => {
  it('strips zero-width, bidi and tag characters', () => {
    expect(stripInvisible('fr​ee‍ ni⁠tro﻿‮')).toBe('free nitro');
    expect(stripInvisible('a\u{E0041}\u{E0042}b')).toBe('ab');
    expect(stripInvisible('a͏b️c឴d')).toBe('abcd');
  });

  it('canonicalizes case, width, diacritics, punctuation and spacing', () => {
    expect(normalizeForComparison('ＢＵＹ　ｎｏｗ!!!')).toBe('buy now');
    expect(normalizeForComparison('  Bûy   NÖW… ')).toBe('buy now');
    expect(normalizeForComparison('b​uy now')).toBe('buy now');
  });

  it('folds Cyrillic and Greek lookalikes, preserving case', () => {
    expect(foldConfusables('раураl')).toBe('paypal');
    expect(foldConfusables('ΡΑΥΡΑL')).toBe('PAYPAL');
    expect(normalizeForComparison('bυy nоw')).toBe('buy now');
  });

  it('skeletons fold digit and letter lookalikes', () => {
    expect(skeleton('disc0rd.gg')).toBe(skeleton('discord.gg'));
    expect(skeleton('dlscord.com')).toBe(skeleton('discord.com'));
    expect(skeleton('steamcommunlty.com')).toBe(skeleton('steamcommunity.com'));
    expect(skeleton('rnoderator')).toBe(skeleton('moderator'));
  });
});

describe('link extraction', () => {
  it('finds scheme links and bare domains', () => {
    expect(hosts('see https://Example.com/path?q=1 and free-nitro.xyz now')).toEqual([
      'example.com',
      'free-nitro.xyz',
    ]);
  });

  it('undoes defanging: hxxp, [.], (dot), {.}, [:], ideographic dots', () => {
    expect(deobfuscate('hxxps[:]//evil[.]com')).toBe('https://evil.com');
    expect(hosts('hxxps://evil[.]com/login')).toEqual(['evil.com']);
    expect(hosts('evil(dot)com/x')).toEqual(['evil.com']);
    expect(hosts('evil{.}com/x')).toEqual(['evil.com']);
    expect(hosts('evil。com/x')).toEqual(['evil.com']);
    expect(hosts('hXXp://evil.com')).toEqual(['evil.com']);
  });

  it('flags links that only appear after deobfuscation', () => {
    const [plain] = extractLinks('https://evil.com');
    const [defanged] = extractLinks('hxxps://evil[.]com');
    const [split] = extractLinks('https://ev​il.com');
    const [fullwidth] = extractLinks('ｅｖｉｌ．ｃｏｍ');
    expect(plain?.obfuscated).toBe(false);
    expect(defanged?.obfuscated).toBe(true);
    expect(split?.obfuscated).toBe(true);
    expect(split?.host).toBe('evil.com');
    expect(fullwidth?.host).toBe('evil.com');
    expect(fullwidth?.obfuscated).toBe(true);
  });

  it('resolves userinfo tricks to the real host', () => {
    expect(hosts('https://discord.com@evil.com/gift')).toEqual(['evil.com']);
  });

  it('matches scheme links glued to preceding text', () => {
    expect(hosts('xhttps://evil.com/a')).toEqual(['evil.com']);
  });

  it('does not read prose, file names or emails as links', () => {
    expect(hosts('open index.ts and readme.md, ok.so what, e.g. this')).toEqual([]);
    expect(hosts('mail me at someone@gmail.com')).toEqual([]);
    expect(hosts('version 1.2.3 of node.js')).toEqual([]);
  });

  it('accepts word-like TLDs only with a path', () => {
    expect(hosts('evil.to')).toEqual([]);
    expect(hosts('evil.to/x')).toEqual(['evil.to']);
  });

  it('keeps IDN hosts in punycode with a unicode display form', () => {
    const [link] = extractLinks('https://discоrd.gg/abc');
    expect(link?.host.startsWith('xn--')).toBe(true);
    expect(link?.displayHost).toBe('discоrd.gg');
  });

  it('ignores non-http schemes and junk', () => {
    expect(hosts('javascript:alert(1) ftp://files.example.com')).toEqual([]);
    expect(hosts('http:// broken')).toEqual([]);
  });

  it('BREAK: stays linear on adversarial input', () => {
    const inputs = [
      'a.'.repeat(4000),
      'a-'.repeat(4000),
      `${'a'.repeat(7990)}.com`,
      'https://'.repeat(1000),
      `${'x.'.repeat(2000)}com/${'y'.repeat(2000)}`,
    ];
    for (const input of inputs) {
      const started = performance.now();
      extractLinks(input);
      extractInvites(input);
      expect(performance.now() - started).toBeLessThan(500);
    }
  });
});

describe('invite extraction', () => {
  it('finds every invite host form', () => {
    expect(
      codes(
        'discord.gg/aB1 https://discord.com/invite/xyz discordapp.com/invite/q-2 dsc.gg/vanity ' +
          'https://discord.gg/invite/abc ptb.discord.com/invite/p1 www.discord.gg/w1',
      ),
    ).toEqual([
      'discord.gg/aB1',
      'discord.com/xyz',
      'discordapp.com/q-2',
      'dsc.gg/vanity',
      'discord.gg/abc',
      'discord.com/p1',
      'discord.gg/w1',
    ]);
  });

  it('preserves code case (invite codes are case-sensitive)', () => {
    expect(extractInvites('discord.gg/AbCd')[0]?.code).toBe('AbCd');
  });

  it('sees through spacing, brackets, zero-width, fullwidth and lookalike letters', () => {
    for (const text of [
      'discord . gg / abc',
      'discord[.]gg/abc',
      'disc​ord.gg/abc',
      'ｄｉｓｃｏｒｄ．ｇｇ/abc',
      'discоrd.gg/abc',
      'DISCORD.GG/abc',
    ]) {
      const [invite] = extractInvites(text);
      expect(invite?.code, text).toBe('abc');
    }
    expect(extractInvites('discord . gg / abc')[0]?.obfuscated).toBe(true);
    expect(extractInvites('discord.gg/abc')[0]?.obfuscated).toBe(false);
  });

  it('does not match lookalike prefixes as real invites', () => {
    expect(codes('notdiscord.gg/abc')).toEqual([]);
  });

  it('classifies invite links for the link rules', () => {
    expect(isInviteLink({ host: 'discord.gg', path: '/abc' })).toBe(true);
    expect(isInviteLink({ host: 'www.discord.com', path: '/invite/abc' })).toBe(true);
    expect(isInviteLink({ host: 'discord.com', path: '/channels/1' })).toBe(false);
  });
});

describe('domain patterns', () => {
  it('denylist entries always cover subdomains', () => {
    expect(matchesDomainPattern('evil.com', 'evil.com', 'deny')).toBe(true);
    expect(matchesDomainPattern('a.b.evil.com', 'evil.com', 'deny')).toBe(true);
    expect(matchesDomainPattern('notevil.com', 'evil.com', 'deny')).toBe(false);
    expect(matchesDomainPattern('evil.com.attacker.net', 'evil.com', 'deny')).toBe(false);
  });

  it('allowlist entries are exact (plus www) unless wildcarded', () => {
    expect(matchesDomainPattern('example.com', 'example.com', 'allow')).toBe(true);
    expect(matchesDomainPattern('www.example.com', 'example.com', 'allow')).toBe(true);
    expect(matchesDomainPattern('docs.example.com', 'example.com', 'allow')).toBe(false);
    expect(matchesDomainPattern('docs.example.com', '*.example.com', 'allow')).toBe(true);
    expect(matchesDomainPattern('example.com', '*.example.com', 'allow')).toBe(true);
    expect(matchesDomainPattern('badexample.com', '*.example.com', 'allow')).toBe(false);
  });

  it('finds the matching pattern', () => {
    expect(findDomainMatch('x.evil.com', ['good.com', '*.evil.com'], 'deny')).toBe('*.evil.com');
    expect(findDomainMatch('x.com', [], 'deny')).toBeNull();
  });
});

describe('lookalike domains', () => {
  const check = (text: string) => {
    const [link] = extractLinks(text);
    return link ? lookalikeOf(link, PROTECTED_DOMAINS) : 'no link';
  };

  it('detects digit, letter and homoglyph imitations', () => {
    expect(check('https://dlscord.com/login')).toBe('discord.com');
    expect(check('https://disc0rd.gg/abc')).toBe('discord.gg');
    expect(check('https://discоrd.gift/nitro')).toBe('discord.gift');
    expect(check('https://steamcommunlty.com/x')).toBe('steamcommunity.com');
    expect(check('https://login.dlscord.com/x')).toBe('discord.com');
  });

  it('leaves genuine and unrelated domains alone', () => {
    expect(check('https://discord.com/channels/1/2')).toBeNull();
    expect(check('https://cdn.discordapp.com/a.png')).toBeNull();
    expect(check('https://example.com')).toBeNull();
  });
});
