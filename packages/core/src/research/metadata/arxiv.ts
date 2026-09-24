import {
  ARXIV_MAX_BYTES,
  MAX_AUTHOR_LENGTH,
  MAX_AUTHORS,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  METADATA_TIMEOUT_MS,
} from '../constants';
import { normalizeArxivId } from '../extraction';
import {
  boundedFetch,
  defaultFetch,
  type FetchLike,
  HttpTransportError,
  isRetryableStatus,
} from '../http';
import { cleanText } from './text';
import { type MetadataResolver, MetadataResolverError, type ResolvedMetadata } from './types';

export const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
const RESOLVER = 'arxiv';
/** Only this many author entries are scanned, whatever the feed contains. */
const MAX_AUTHOR_SCAN = 200;

function firstTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return match?.[1] ?? null;
}

function authorNames(entry: string): string[] {
  const names: string[] = [];
  let scanned = 0;
  for (const match of entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/gi)) {
    if (++scanned > MAX_AUTHOR_SCAN) break;
    const name = cleanText(match[1], MAX_AUTHOR_LENGTH);
    if (name) names.push(name);
    if (names.length >= MAX_AUTHORS) break;
  }
  return names;
}

export interface ArxivResolverOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
}

/** arXiv metadata from the Atom API (`/api/query?id_list=`). */
export class ArxivResolver implements MetadataResolver {
  readonly name = RESOLVER;
  readonly kind = 'arxiv' as const;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: ArxivResolverOptions = {}) {
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.baseUrl = options.baseUrl ?? ARXIV_API_BASE;
    this.timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS;
  }

  async resolve(arxivId: string): Promise<ResolvedMetadata | null> {
    const url = `${this.baseUrl}?id_list=${encodeURIComponent(arxivId)}&max_results=1`;
    let response;
    try {
      response = await boundedFetch(this.fetchImpl, url, {
        headers: { accept: 'application/atom+xml' },
        timeoutMs: this.timeoutMs,
        maxBytes: ARXIV_MAX_BYTES,
      });
    } catch (error) {
      const failure = error instanceof HttpTransportError ? error.failure : 'network';
      throw new MetadataResolverError(RESOLVER, failure, failure !== 'too_large');
    }
    if (!response.ok) {
      throw new MetadataResolverError(
        RESOLVER,
        `HTTP ${response.status}`,
        isRetryableStatus(response.status),
      );
    }
    const entry = firstTag(response.text, 'entry');
    if (!entry) return null;
    // arXiv reports unknown ids as an error entry; accept only the requested paper.
    const entryId = firstTag(entry, 'id') ?? '';
    const idMatch = /arxiv\.org\/abs\/(.+?)\s*$/i.exec(entryId.trim());
    if (!idMatch?.[1] || normalizeArxivId(idMatch[1]) !== arxivId) return null;
    const published = firstTag(entry, 'published')?.trim() ?? '';
    return {
      title: cleanText(firstTag(entry, 'title'), MAX_TITLE_LENGTH),
      authors: authorNames(entry),
      source: 'arXiv',
      publishedOn: /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : null,
      abstract: cleanText(firstTag(entry, 'summary'), MAX_SUMMARY_LENGTH),
    };
  }
}
