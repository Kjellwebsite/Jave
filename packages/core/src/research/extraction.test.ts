import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  extractArxivIds,
  extractDois,
  extractResearchCandidate,
  extractUrls,
  guessTitle,
  normalizeArxivId,
  normalizeDoi,
  titleFromUrl,
} from './extraction';

describe('DOI extraction', () => {
  it.each([
    ['See 10.1038/nature12373.', ['10.1038/nature12373']],
    ['doi:10.1000/XYZ123', ['10.1000/xyz123']],
    ['https://doi.org/10.1103/PhysRevLett.116.061102', ['10.1103/physrevlett.116.061102']],
    ['(10.1016/S0140-6736(20)30183-5)', ['10.1016/s0140-6736(20)30183-5']],
    ['**10.1145/3368089.3409741**', ['10.1145/3368089.3409741']],
    [
      'https://onlinelibrary.wiley.com/doi/full/10.1002/anie.202012345/abstract',
      ['10.1002/anie.202012345'],
    ],
    ['two: 10.1/abc and 10.5555/12345678, then 10.5555/12345678 again', ['10.5555/12345678']],
    ['no doi here, version 10.2 of the app', []],
    ['https://doi.org/10.1038/NATURE12373?utm_source=tw', ['10.1038/nature12373']],
    ['https://publisher.example/doi/10.1000/abc?ref=feed#fig1', ['10.1000/abc']],
  ])('%j → %j', (input, expected) => {
    expect(extractDois(input)).toEqual(expected);
  });

  it('normalizes encoded doi.org paths and rejects junk', () => {
    expect(normalizeDoi('https://doi.org/10.1000%2Fabc')).toBe('10.1000/abc');
    expect(normalizeDoi('https://doi.org/10.1000/%E0%A4%A')).toBeNull();
    expect(normalizeDoi('not a doi')).toBeNull();
    expect(normalizeDoi(`10.1000/${'x'.repeat(300)}`)).toBeNull();
  });
});

describe('arXiv extraction', () => {
  it.each([
    ['arXiv:2401.01234', '2401.01234'],
    ['arXiv:2401.01234v3', '2401.01234'],
    ['arxiv: 1706.03762', '1706.03762'],
    ['arXiv:0704.0001', '0704.0001'],
    ['arXiv:1412.6980', '1412.6980'],
    ['arXiv:hep-th/9901001', 'hep-th/9901001'],
    ['arXiv:math.gt/0309136v2', 'math.GT/0309136'],
    ['arXiv:cond-mat/0207270', 'cond-mat/0207270'],
    ['https://arxiv.org/abs/2106.09685v2', '2106.09685'],
    ['https://arxiv.org/pdf/2106.09685v2.pdf', '2106.09685'],
    ['https://export.arxiv.org/abs/hep-th/9901001', 'hep-th/9901001'],
  ])('%j → %s', (input, expected) => {
    expect(extractArxivIds(input)).toEqual([expected]);
  });

  it.each([
    ['2401.01234', 'bare ids without an arXiv prefix are ignored'],
    ['arXiv:2413.01234', 'month 13'],
    ['arXiv:0612.0001', 'new scheme did not exist yet'],
    ['arXiv:1501.1234', '2015+ requires five digits'],
    ['arXiv:1412.12345', 'pre-2015 requires four digits'],
    ['arXiv:hep-th/0801001', 'old scheme ended in 2007'],
  ])('rejects %j (%s)', (input) => {
    expect(extractArxivIds(input)).toEqual([]);
  });

  it('normalizes directly', () => {
    expect(normalizeArxivId('2401.01234v2.')).toBe('2401.01234');
    expect(normalizeArxivId('garbage')).toBeNull();
  });
});

describe('URL extraction and canonicalization', () => {
  it('extracts URLs, trimming punctuation, Discord angle brackets and markdown', () => {
    expect(
      extractUrls(
        'Read https://example.com/paper. Also <https://example.org/x> and [link](https://en.wikipedia.org/wiki/Foo_(bar)) — ftp://nope',
      ),
    ).toEqual([
      'https://example.com/paper',
      'https://example.org/x',
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it.each([
    ['https://Example.COM/Paper/', 'https://example.com/Paper'],
    [
      'https://example.com/a?utm_source=x&b=2&fbclid=1&a=1&gclid=z&UTM_Campaign=y#section',
      'https://example.com/a?a=1&b=2',
    ],
    ['https://example.com/', 'https://example.com'],
    ['https://user:pass@example.com/x', 'https://example.com/x'],
    ['http://example.com:80/x', 'http://example.com/x'],
    ['https://example.com:8443/x/', 'https://example.com:8443/x'],
    ['https://arxiv.org/pdf/2106.09685v2.pdf', 'https://arxiv.org/abs/2106.09685'],
    ['https://dx.doi.org/10.1000/ABC', 'https://doi.org/10.1000/abc'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'ftp://example.com/file',
    'not a url',
    'https://cdn.discordapp.com/attachments/1/2/paper.pdf?ex=abc',
    'https://discord.com/channels/1/2/3',
  ])('BREAK: refuses %s', (input) => {
    expect(canonicalizeUrl(input)).toBeNull();
  });

  it('BREAK: never keeps credentials embedded in a shared link', () => {
    expect(extractUrls('see https://alice:hunter2@example.com/paper')).toEqual([
      'https://example.com/paper',
    ]);
    const candidate = extractResearchCandidate('Paper https://bob:pw@journal.example/a/1');
    expect(candidate.url).toBe('https://journal.example/a/1');
    expect(JSON.stringify(candidate)).not.toContain('pw@');
  });

  it('caps the number of URLs considered', () => {
    const many = Array.from({ length: 50 }, (_, i) => `https://e.com/${i}`).join(' ');
    expect(extractUrls(many)).toHaveLength(20);
  });
});

describe('title guess', () => {
  it.each([
    [
      '**Attention Is All You Need**\nhttps://arxiv.org/abs/1706.03762',
      'Attention Is All You Need',
    ],
    [
      'https://example.com/x\n> Scaling laws for neural language models — worth a read',
      'Scaling laws for neural language models — worth a read',
    ],
    ['<@123456789012345678> check arXiv:1706.03762', null],
    ['doi:10.1038/nature12373', null],
    ['short', null],
  ])('%j → %j', (input, expected) => {
    expect(guessTitle(input)).toBe(expected);
  });

  it('falls back to a readable URL segment', () => {
    expect(titleFromUrl('https://example.com/blog/sparse-attention-explained')).toBe(
      'sparse attention explained',
    );
    expect(titleFromUrl('https://example.com/')).toBe('example.com');
  });
});

describe('extractResearchCandidate', () => {
  it('prefers a reference link over Discord links and derives identifiers', () => {
    const candidate = extractResearchCandidate(
      'https://discord.com/channels/1/2/3\nGreat paper https://arxiv.org/abs/1706.03762v7?utm_source=x',
    );
    expect(candidate).toEqual({
      doi: null,
      arxivId: '1706.03762',
      url: 'https://arxiv.org/abs/1706.03762v7?utm_source=x',
      canonicalUrl: 'https://arxiv.org/abs/1706.03762',
      titleGuess: 'Great paper',
    });
  });

  it('builds a link from a bare DOI and titles it', () => {
    expect(extractResearchCandidate('doi:10.1038/NATURE12373')).toEqual({
      doi: '10.1038/nature12373',
      arxivId: null,
      url: 'https://doi.org/10.1038/nature12373',
      canonicalUrl: 'https://doi.org/10.1038/nature12373',
      titleGuess: 'DOI 10.1038/nature12373',
    });
  });

  it('uses an attachment when the message has no reference link', () => {
    const candidate = extractResearchCandidate('', [
      {
        url: 'https://cdn.discordapp.com/attachments/1/2/sleep_and_memory_2024.pdf',
        filename: 'sleep_and_memory_2024.pdf',
      },
    ]);
    expect(candidate.url).toContain('cdn.discordapp.com');
    expect(candidate.canonicalUrl).toBeNull();
    expect(candidate.titleGuess).toBe('sleep and memory 2024');
  });

  it('returns an empty candidate for chatter', () => {
    expect(extractResearchCandidate('lol')).toEqual({
      doi: null,
      arxivId: null,
      url: null,
      canonicalUrl: null,
      titleGuess: null,
    });
  });
});
