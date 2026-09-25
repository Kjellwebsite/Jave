import { describe, expect, it } from 'vitest';
import { isBlockedAddress, parseIPv6, validateOutboundUrl } from './ssrf';

const strict = { allowInsecure: false };
const dev = { allowInsecure: true };

describe('SSRF validator', () => {
  it.each([
    'https://hooks.example.com/jave',
    'https://example.com:8443/path?x=1',
    'https://8.8.8.8/',
    'https://[2606:4700:4700::1111]/',
    'https://[2002:0808:0808::1]/', // 6to4 wrapping a public IPv4
    'https://xn--80ak6aa92e.com/',
  ])('allows %s', (url) => {
    expect(validateOutboundUrl(url, strict)).toMatchObject({ ok: true });
  });

  it.each([
    // scheme and credentials
    ['http://example.com/', 'https required'],
    ['ftp://example.com/', 'https required'],
    ['file:///etc/passwd', 'https required'],
    ['javascript:alert(1)', 'https required'],
    ['https://user:pass@example.com/', 'credentials in URL'],
    ['not a url', 'not a valid URL'],
    [`https://example.com/${'a'.repeat(2100)}`, 'URL too long'],
    // hostnames
    ['https://localhost/', 'internal hostname'],
    ['https://LOCALHOST./', 'internal hostname'],
    ['https://api.localhost/', 'internal hostname'],
    ['https://printer.local/', 'internal hostname'],
    ['https://metadata.google.internal/', 'internal hostname'],
    ['https://router.lan/', 'internal hostname'],
    ['https://intranet/', 'single-label hostname'],
    // IPv4 literals, including decimal / hex / octal / short forms
    ['https://127.0.0.1/', 'private or reserved IPv4 address'],
    ['https://127.1/', 'private or reserved IPv4 address'],
    ['https://2130706433/', 'private or reserved IPv4 address'],
    ['https://0x7f000001/', 'private or reserved IPv4 address'],
    ['https://0x7f.0.0.1/', 'private or reserved IPv4 address'],
    ['https://017700000001/', 'private or reserved IPv4 address'],
    ['https://0/', 'private or reserved IPv4 address'],
    ['https://0.0.0.0/', 'private or reserved IPv4 address'],
    ['https://10.1.2.3/', 'private or reserved IPv4 address'],
    ['https://172.16.0.1/', 'private or reserved IPv4 address'],
    ['https://172.31.255.255/', 'private or reserved IPv4 address'],
    ['https://192.168.1.1/', 'private or reserved IPv4 address'],
    ['https://169.254.169.254/latest/meta-data/', 'private or reserved IPv4 address'],
    ['https://100.64.0.1/', 'private or reserved IPv4 address'],
    ['https://198.18.0.1/', 'private or reserved IPv4 address'],
    ['https://224.0.0.1/', 'private or reserved IPv4 address'],
    ['https://255.255.255.255/', 'private or reserved IPv4 address'],
    ['https://192.0.2.10/', 'private or reserved IPv4 address'],
    // IPv6 literals
    ['https://[::1]/', 'private or reserved IPv6 address'],
    ['https://[::]/', 'private or reserved IPv6 address'],
    ['https://[0:0:0:0:0:0:0:1]/', 'private or reserved IPv6 address'],
    ['https://[::ffff:127.0.0.1]/', 'private or reserved IPv6 address'],
    ['https://[::ffff:7f00:1]/', 'private or reserved IPv6 address'],
    ['https://[::ffff:169.254.169.254]/', 'private or reserved IPv6 address'],
    ['https://[::127.0.0.1]/', 'private or reserved IPv6 address'],
    ['https://[64:ff9b::a9fe:a9fe]/', 'private or reserved IPv6 address'],
    ['https://[fe80::1]/', 'private or reserved IPv6 address'],
    ['https://[fc00::1]/', 'private or reserved IPv6 address'],
    ['https://[fd12:3456::1]/', 'private or reserved IPv6 address'],
    ['https://[ff02::1]/', 'private or reserved IPv6 address'],
    ['https://[2001:db8::1]/', 'private or reserved IPv6 address'],
    ['https://[2001::1]/', 'private or reserved IPv6 address'],
    ['https://[2002:7f00:1::]/', 'private or reserved IPv6 address'],
    ['https://[2002:c0a8:0101::1]/', 'private or reserved IPv6 address'],
  ])('BREAK: rejects %s (%s)', (url, reason) => {
    expect(validateOutboundUrl(url, strict)).toEqual({ ok: false, reason });
  });

  it('allows http only with the development flag, and never for private targets', () => {
    expect(validateOutboundUrl('http://example.com/', dev)).toMatchObject({ ok: true });
    expect(validateOutboundUrl('http://127.0.0.1/', dev)).toEqual({
      ok: false,
      reason: 'private or reserved IPv4 address',
    });
    expect(validateOutboundUrl('http://localhost:3000/', dev)).toEqual({
      ok: false,
      reason: 'internal hostname',
    });
  });

  it('classifies resolved addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.8',
      '::1',
      'fe80::1%eth0',
      '::ffff:10.0.0.1',
      'garbage',
    ]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
    for (const address of ['93.184.216.34', '2606:4700::6810:84e5']) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });

  it('parses IPv6 forms strictly', () => {
    expect(parseIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('[::ffff:1.2.3.4]')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIPv6('1::2::3')).toBeNull();
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIPv6('12345::')).toBeNull();
    expect(parseIPv6('example.com')).toBeNull();
  });
});
