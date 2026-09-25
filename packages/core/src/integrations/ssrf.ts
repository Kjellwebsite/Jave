import { MAX_URL_LENGTH } from '../projects/schemas';

/**
 * SSRF defense for outbound webhook targets.
 *
 * Checked when a subscription is saved and again before every delivery:
 *  - https only (http only with the DEVELOPMENT ONLY allowInsecureForDev flag)
 *  - no credentials in the URL
 *  - no localhost / single-label / internal-TLD hostnames
 *  - no private, loopback, link-local, CGNAT, multicast, reserved or
 *    documentation IP literals (IPv4 and IPv6, including IPv4-mapped,
 *    NAT64 and 6to4 embeddings). Decimal/hex/octal IPv4 tricks
 *    (http://2130706433, http://0x7f.1) are normalized by the WHATWG URL
 *    parser into dotted form before the check.
 *
 * The delivery job additionally resolves the hostname and refuses private
 * answers. Limitation: DNS can change between that lookup and the
 * connection (rebinding); pinning the resolved address requires a custom
 * HTTP agent (extension point: inject a pinning `fetch`).
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet'];

/** [network, prefix length] in dotted form. */
const BLOCKED_IPV4_RANGES: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata lives here)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const IPV4_PART = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/;
const IPV6_GROUPS = 8;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;

/** Strict dotted-quad parser (the URL parser has already normalized other notations). */
export function parseIPv4(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((part) => IPV4_PART.test(part))) return null;
  return parts.map(Number);
}

function ipv4ToInt(octets: readonly number[]): number {
  return octets.reduce((acc, octet) => acc * 256 + octet, 0);
}

function inIPv4Range(octets: readonly number[], network: string, prefix: number): boolean {
  const base = parseIPv4(network);
  if (!base) return false;
  const size = 2 ** (32 - prefix);
  const start = ipv4ToInt(base);
  const value = ipv4ToInt(octets);
  return value >= start && value < start + size;
}

export function isBlockedIPv4(octets: readonly number[]): boolean {
  return BLOCKED_IPV4_RANGES.some(([network, prefix]) => inIPv4Range(octets, network, prefix));
}

/** Parse an IPv6 literal (brackets, zone id and embedded IPv4 allowed) into 8 groups. */
export function parseIPv6(input: string): number[] | null {
  const host = input.replace(/^\[/, '').replace(/\]$/, '').split('%')[0]!.toLowerCase();
  if (!host.includes(':')) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    const pieces = part.split(':');
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes('.') && index === pieces.length - 1) {
        const v4 = parseIPv4(piece);
        if (!v4) return null;
        out.push((v4[0]! << BITS_PER_BYTE) | v4[1]!, (v4[2]! << BITS_PER_BYTE) | v4[3]!);
      } else if (IPV6_GROUP.test(piece)) {
        out.push(parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = toGroups(halves[0]!);
  const tail = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 2) {
    const missing = IPV6_GROUPS - head.length - tail.length;
    if (missing < 1) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
  }
  return head.length === IPV6_GROUPS ? head : null;
}

function embeddedIPv4(high: number, low: number): number[] {
  return [high >> BITS_PER_BYTE, high & BYTE_MASK, low >> BITS_PER_BYTE, low & BYTE_MASK];
}

/**
 * Allowlist approach: only global unicast (2000::/3) may be contacted, minus
 * documentation, IETF special-purpose (incl. Teredo) and 6to4 wrappers of
 * blocked IPv4 space. Everything else — ::, ::1, IPv4-mapped/compatible,
 * NAT64, ULA fc00::/7, link-local fe80::/10, multicast — is refused.
 */
export function isBlockedIPv6(groups: readonly number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0] = groups;
  const GLOBAL_UNICAST_MASK = 0xe000;
  const GLOBAL_UNICAST = 0x2000;
  if ((g0 & GLOBAL_UNICAST_MASK) !== GLOBAL_UNICAST) return true;
  const IETF_SPECIAL = 0x2001;
  const IETF_SPECIAL_END = 0x0200; // 2001::/23
  const DOCUMENTATION = 0x0db8; // 2001:db8::/32
  if (g0 === IETF_SPECIAL && (g1 < IETF_SPECIAL_END || g1 === DOCUMENTATION)) return true;
  const SIX_TO_FOUR = 0x2002; // 2002::/16 embeds an IPv4 address
  if (g0 === SIX_TO_FOUR && isBlockedIPv4(embeddedIPv4(g1, g2))) return true;
  return false;
}

/** For resolved addresses: true when an address must never be contacted. */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6) return isBlockedIPv6(v6);
  return true;
}

function hostnameProblem(hostname: string): string | null {
  const host = hostname.replace(/\.+$/, '');
  if (host.length === 0) return 'missing host';
  if (host.startsWith('[')) {
    const v6 = parseIPv6(host);
    if (!v6) return 'invalid IPv6 address';
    return isBlockedIPv6(v6) ? 'private or reserved IPv6 address' : null;
  }
  const v4 = parseIPv4(host);
  if (v4) return isBlockedIPv4(v4) ? 'private or reserved IPv4 address' : null;
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return 'internal hostname';
  }
  if (!host.includes('.')) return 'single-label hostname';
  return null;
}

export function validateOutboundUrl(raw: string, options: { allowInsecure: boolean }): UrlCheck {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: 'URL too long' };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'https:' && !(options.allowInsecure && url.protocol === 'http:')) {
    return { ok: false, reason: 'https required' };
  }
  if (url.username || url.password) return { ok: false, reason: 'credentials in URL' };
  const problem = hostnameProblem(url.hostname.toLowerCase());
  return problem ? { ok: false, reason: problem } : { ok: true, url };
}

/** True when a hostname is an IP literal (no DNS lookup needed). */
export function isIpLiteral(hostname: string): boolean {
  return parseIPv4(hostname) !== null || parseIPv6(hostname) !== null;
}
