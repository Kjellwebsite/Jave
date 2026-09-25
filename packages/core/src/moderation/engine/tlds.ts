/**
 * Top-level domains used to recognise bare domains (links written without a
 * scheme, e.g. `free-nitro.xyz`). Links with an explicit scheme are always
 * recognised regardless of TLD; this list only exists to keep ordinary prose
 * ("index.ts", "readme.md", "ok.so what") from being read as links.
 *
 * STRONG: a bare `name.tld` is treated as a link.
 * WEAK: TLDs that double as English words or file extensions; a bare domain
 * with one of these only counts when a path follows (`evil.to/x`).
 */
const STRONG_TLDS = new Set(
  (
    'com net org edu gov mil int io gg co xyz ru cn info biz app dev ai ly gl gd link click top ' +
    'online site shop store live club vip win bid best icu buzz fun space website tech pro cloud ' +
    'host art page blog news money cash work world today life tk ml ga cf gq pw su ws la gift ' +
    'gifts help support tokyo moe ninja rocks lol wtf zone asia eu uk de fr nl br jp kr ua pl ' +
    'es ch se dk fi cz sk hu ro bg gr pt ie nz au ca mx ar cl pe za ng ke eg sa ae tr ir pk bd ' +
    'vn th ph sg hk tw one xin vip loan men date racing review party stream trade download ' +
    'country kim cricket science faith accountant email network systems digital global solutions ' +
    'agency media social games game casino bet poker promo deals sale discount codes'
  ).split(' '),
);

const WEAK_TLDS = new Set(
  (
    'is in me to at it us no be so do go am fm tv id my by ms st lt re im an as or sh md rs py ' +
    'zip mov cc nu ac ag al az ba cx gs ht hn kz lv mn mu nf nr pm pn sc sr tc tl tm vc vg vu yt'
  ).split(' '),
);

export type TldStrength = 'strong' | 'weak';

export function tldStrength(tld: string): TldStrength | null {
  const key = tld.toLowerCase();
  if (STRONG_TLDS.has(key)) return 'strong';
  if (WEAK_TLDS.has(key)) return 'weak';
  return null;
}
