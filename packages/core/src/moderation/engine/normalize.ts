/**
 * Pure text normalization for automod. Spammers split words and links with
 * invisible characters, swap Latin letters for Cyrillic/Greek lookalikes,
 * use fullwidth or "mathematical" letters and vary case and spacing. These
 * helpers fold all of that into a canonical form before comparison.
 */

/**
 * Invisible / formatting code points: soft hyphen, combining grapheme joiner,
 * Arabic letter mark, Hangul fillers, Mongolian vowel separator, zero-width
 * space/joiners, directional marks and overrides, word joiner and invisible
 * operators, variation selectors, BOM, and Unicode tag characters.
 */
const INVISIBLE_CLASS =
  '(?:[\\u00AD\\u061C\\u115F\\u1160\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\u3164\\uFEFF\\uFFA0\\u{E0000}-\\u{E007F}]|\\u034F|\\u17B4|\\u17B5|[\\uFE00-\\uFE0F])';
const INVISIBLE_ALL = new RegExp(INVISIBLE_CLASS, 'gu');
const INVISIBLE_ANY = new RegExp(INVISIBLE_CLASS, 'u');

const COMBINING_MARK = /\p{M}/gu;

/**
 * Basic confusables: Cyrillic, Greek and a few Latin lookalikes → Latin.
 * Case is preserved where the lookalike has a case (А→A, а→a).
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic lowercase
  а: 'a',
  в: 'b',
  с: 'c',
  ԁ: 'd',
  е: 'e',
  ё: 'e',
  һ: 'h',
  і: 'i',
  ї: 'i',
  ј: 'j',
  к: 'k',
  ӏ: 'l',
  м: 'm',
  п: 'n',
  о: 'o',
  р: 'p',
  ԛ: 'q',
  г: 'r',
  ѕ: 's',
  т: 't',
  у: 'y',
  х: 'x',
  ԝ: 'w',
  // Cyrillic uppercase
  А: 'A',
  В: 'B',
  С: 'C',
  Е: 'E',
  Н: 'H',
  І: 'I',
  Ј: 'J',
  К: 'K',
  М: 'M',
  О: 'O',
  Р: 'P',
  Ѕ: 'S',
  Т: 'T',
  Х: 'X',
  У: 'Y',
  Ԝ: 'W',
  // Greek lowercase
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  // Greek uppercase
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
  // Latin lookalikes
  ı: 'i',
  ȷ: 'j',
  ɡ: 'g',
  ɑ: 'a',
  ʏ: 'y',
};

const CONFUSABLE_PATTERN = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'gu');

export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_ALL, '');
}

export function hasInvisible(text: string): boolean {
  return INVISIBLE_ANY.test(text);
}

/** Replace basic lookalike letters with their Latin counterpart (case preserved). */
export function foldConfusables(text: string): string {
  return text.replace(CONFUSABLE_PATTERN, (char) => CONFUSABLES[char] ?? char);
}

/**
 * Canonical form for duplicate detection: compatibility-folded, diacritics and
 * invisible characters removed, lookalikes folded, lowercased, punctuation and
 * symbols dropped, whitespace collapsed.
 */
export function normalizeForComparison(text: string): string {
  return foldConfusables(stripInvisible(text).normalize('NFKD').replace(COMBINING_MARK, ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Skeleton used to compare domains and names for lookalikes: canonical form
 * plus digit/letter folding (0→o, 1/i/l→l, rn→m).
 */
export function skeleton(text: string): string {
  return foldConfusables(stripInvisible(text).normalize('NFKD').replace(COMBINING_MARK, ''))
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/0/g, 'o')
    .replace(/[1i|]/g, 'l');
}
