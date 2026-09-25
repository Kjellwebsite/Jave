import { describe, expect, it } from 'vitest';
import { createFakeFetch, hang, json, networkError, text } from '@jave/ai/testing';
import { ARXIV_MAX_BYTES } from './constants';
import { ArxivResolver } from './metadata/arxiv';
import { CrossrefResolver } from './metadata/crossref';
import { cleanText, decodeEntities, isoDateFromParts } from './metadata/text';
import { MetadataResolverError } from './metadata/types';
import { arxivFeed, CROSSREF_WORK } from './testing/fixtures';
import {
  createSidusClient,
  HttpSidusClient,
  NotConfiguredSidusClient,
  SidusNotConfiguredError,
  SidusSyncError,
} from './sidus';

describe('text helpers', () => {
  it('decodes entities, strips markup, and keeps decoded comparisons as text', () => {
    expect(decodeEntities('&lt;b&gt; &#65; &#x42; &amp; &unknown;')).toBe('<b> A B & &unknown;');
    expect(cleanText('<jats:p>Hi\u0007 there</jats:p>', 100)).toBe('Hi there');
    expect(cleanText('<p>effect p &lt; 0.05 and q &gt; 0.1</p>', 100)).toBe(
      'effect p < 0.05 and q > 0.1',
    );
    expect(cleanText('p < 0.05 and q > 0.1', 100)).toBe('p < 0.05 and q > 0.1');
    expect(cleanText('   ', 10)).toBeNull();
    expect(cleanText('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('builds ISO dates and rejects impossible ones', () => {
    expect(isoDateFromParts([2013, 7, 31])).toBe('2013-07-31');
    expect(isoDateFromParts([2013])).toBe('2013-01-01');
    expect(isoDateFromParts([2013, 2, 30])).toBeNull();
    expect(isoDateFromParts([99999])).toBeNull();
    expect(isoDateFromParts(undefined)).toBeNull();
  });
});

describe('CrossrefResolver', () => {
  it('parses a work', async () => {
    const fake = createFakeFetch([json(200, CROSSREF_WORK)]);
    const resolver = new CrossrefResolver({ fetch: fake.fetch, contactEmail: 'ops@example.org' });
    await expect(resolver.resolve('10.1038/nature12373')).resolves.toEqual({
      title: 'Nanometre-scale thermometry in a living cell',
      authors: ['G. Kucsko', 'P. C. Maurer', 'The Lab Consortium'],
      source: 'Nature',
      publishedOn: '2013-07-31',
      abstract: 'Sensitive probing of temperature & heat.',
    });
    expect(fake.requests[0]!.url).toBe('https://api.crossref.org/works/10.1038%2Fnature12373');
    expect(fake.requests[0]!.headers.get('user-agent')).toContain('mailto:ops@example.org');
  });

  it('returns null for unknown DOIs and classifies failures', async () => {
    await expect(
      new CrossrefResolver({ fetch: createFakeFetch([json(404, {})]).fetch }).resolve('10.1/x'),
    ).resolves.toBeNull();
    const outage = await new CrossrefResolver({ fetch: createFakeFetch([json(503, {})]).fetch })
      .resolve('10.1/x')
      .catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(MetadataResolverError);
    expect((outage as MetadataResolverError).retryable).toBe(true);
    const bad = await new CrossrefResolver({ fetch: createFakeFetch([text(200, 'nope')]).fetch })
      .resolve('10.1/x')
      .catch((e: unknown) => e);
    expect((bad as MetadataResolverError).retryable).toBe(false);
    const down = await new CrossrefResolver({ fetch: createFakeFetch([networkError()]).fetch })
      .resolve('10.1/x')
      .catch((e: unknown) => e);
    expect((down as MetadataResolverError).retryable).toBe(true);
  });

  it('times out', async () => {
    const resolver = new CrossrefResolver({
      fetch: createFakeFetch([hang()]).fetch,
      timeoutMs: 20,
    });
    await expect(resolver.resolve('10.1/x')).rejects.toThrow('crossref: timeout');
  });
});

describe('ArxivResolver', () => {
  it('parses the Atom entry', async () => {
    const fake = createFakeFetch([text(200, arxivFeed('1706.03762'))]);
    const metadata = await new ArxivResolver({ fetch: fake.fetch }).resolve('1706.03762');
    expect(metadata).toEqual({
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      source: 'arXiv',
      publishedOn: '2017-06-12',
      abstract:
        'The dominant sequence transduction models are based on complex recurrent <or> convolutional networks.',
    });
    expect(fake.requests[0]!.url).toBe(
      'https://export.arxiv.org/api/query?id_list=1706.03762&max_results=1',
    );
  });

  it('BREAK: ignores error entries and entries for other papers', async () => {
    const errorFeed = `<feed><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><title>Error</title></entry></feed>`;
    await expect(
      new ArxivResolver({ fetch: createFakeFetch([text(200, errorFeed)]).fetch }).resolve(
        '1706.03762',
      ),
    ).resolves.toBeNull();
    await expect(
      new ArxivResolver({
        fetch: createFakeFetch([text(200, arxivFeed('2001.00001'))]).fetch,
      }).resolve('1706.03762'),
    ).resolves.toBeNull();
    await expect(
      new ArxivResolver({ fetch: createFakeFetch([text(200, '<feed></feed>')]).fetch }).resolve(
        '1706.03762',
      ),
    ).resolves.toBeNull();
  });

  it('BREAK: refuses oversized responses without retrying', async () => {
    const huge = text(200, `<feed>${'x'.repeat(ARXIV_MAX_BYTES + 1)}</feed>`);
    const error = await new ArxivResolver({ fetch: createFakeFetch([huge]).fetch })
      .resolve('1706.03762')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetadataResolverError);
    expect((error as MetadataResolverError).retryable).toBe(false);
  });
});

describe('Sidus clients', () => {
  const item = {
    externalRef: '5f0c6f1e-6a55-4d2c-9d7e-2d1f3b8a9c10',
    title: 'T',
    authors: [],
    doi: null,
    arxivId: null,
    url: null,
    canonicalUrl: null,
    topic: null,
    tags: [],
    summary: null,
    evidenceLevel: 'peer_reviewed',
    publishedOn: null,
    verifiedAt: null,
    source: 'jave' as const,
  };

  it('not-configured client never pretends to sync', async () => {
    const client = createSidusClient({});
    expect(client).toBeInstanceOf(NotConfiguredSidusClient);
    await expect(client.pushItem(item)).rejects.toBeInstanceOf(SidusNotConfiguredError);
    await expect(client.health()).resolves.toMatchObject({ ok: false });
    expect(createSidusClient({ baseUrl: 'https://sidus.example.com' })).toBeInstanceOf(
      NotConfiguredSidusClient,
    );
  });

  it('upserts over HTTPS with bearer auth', async () => {
    const fake = createFakeFetch([json(200, { id: 'sidus_123' })]);
    const client = new HttpSidusClient({
      baseUrl: 'https://sidus.example.com/',
      apiKey: 'sidus-secret-key',
      fetch: fake.fetch,
    });
    await expect(client.pushItem(item)).resolves.toEqual({ externalId: 'sidus_123' });
    const sent = fake.requests[0]!;
    expect(sent.method).toBe('PUT');
    expect(sent.url).toBe(
      `https://sidus.example.com/v1/research-items/by-external-ref/${item.externalRef}`,
    );
    expect(sent.headers.get('authorization')).toBe('Bearer sidus-secret-key');
    expect(JSON.parse(sent.body)).toEqual(item);
  });

  it('classifies failures without leaking the key', async () => {
    const cases: [ReturnType<typeof json>, boolean][] = [
      [json(503, {}), true],
      [json(429, {}), true],
      [json(401, {}), false],
      [json(422, {}), false],
      [json(200, { nope: true }), false],
    ];
    for (const [route, retryable] of cases) {
      const client = new HttpSidusClient({
        baseUrl: 'https://sidus.example.com',
        apiKey: 'sidus-secret-key',
        fetch: createFakeFetch([route]).fetch,
      });
      const error = await client.pushItem(item).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SidusSyncError);
      expect((error as SidusSyncError).retryable).toBe(retryable);
      expect((error as Error).message).not.toContain('sidus-secret-key');
    }
  });

  it('BREAK: refuses insecure or credentialed base URLs', () => {
    for (const baseUrl of [
      'http://sidus.example.com',
      'https://user:pw@sidus.example.com',
      'ftp://sidus.example.com',
    ]) {
      expect(() => new HttpSidusClient({ baseUrl, apiKey: 'k' })).toThrow();
    }
    expect(
      () => new HttpSidusClient({ baseUrl: 'http://localhost:8787', apiKey: 'k' }),
    ).not.toThrow();
  });
});
