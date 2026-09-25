import { z } from 'zod';
import {
  CROSSREF_MAX_BYTES,
  MAX_AUTHOR_LENGTH,
  MAX_AUTHORS,
  MAX_SOURCE_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  METADATA_TIMEOUT_MS,
} from '../constants';
import {
  boundedFetch,
  defaultFetch,
  type FetchLike,
  HttpTransportError,
  isRetryableStatus,
} from '../http';
import { cleanText, isoDateFromParts } from './text';
import { type MetadataResolver, MetadataResolverError, type ResolvedMetadata } from './types';

export const CROSSREF_API_BASE = 'https://api.crossref.org';
const RESOLVER = 'crossref';

const dateSchema = z.object({ 'date-parts': z.array(z.array(z.number())).optional() }).optional();

const workSchema = z.object({
  message: z.object({
    title: z.array(z.string()).optional(),
    author: z
      .array(
        z.object({
          given: z.string().optional(),
          family: z.string().optional(),
          name: z.string().optional(),
        }),
      )
      .optional(),
    'container-title': z.array(z.string()).optional(),
    publisher: z.string().optional(),
    published: dateSchema,
    'published-print': dateSchema,
    'published-online': dateSchema,
    issued: dateSchema,
    abstract: z.string().optional(),
  }),
});

export interface CrossrefResolverOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  /** Crossref's "polite pool" asks for a contact address in the User-Agent. */
  contactEmail?: string;
}

/** DOI metadata from the Crossref REST API (`GET /works/{doi}`). */
export class CrossrefResolver implements MetadataResolver {
  readonly name = RESOLVER;
  readonly kind = 'doi' as const;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: CrossrefResolverOptions = {}) {
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.baseUrl = (options.baseUrl ?? CROSSREF_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS;
    const contact = options.contactEmail ? `; mailto:${options.contactEmail}` : '';
    this.userAgent = `JAVE/0.1 (research enrichment${contact})`;
  }

  async resolve(doi: string): Promise<ResolvedMetadata | null> {
    let response;
    try {
      response = await boundedFetch(
        this.fetchImpl,
        `${this.baseUrl}/works/${encodeURIComponent(doi)}`,
        {
          headers: { accept: 'application/json', 'user-agent': this.userAgent },
          timeoutMs: this.timeoutMs,
          maxBytes: CROSSREF_MAX_BYTES,
        },
      );
    } catch (error) {
      const failure = error instanceof HttpTransportError ? error.failure : 'network';
      throw new MetadataResolverError(RESOLVER, failure, failure !== 'too_large');
    }
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new MetadataResolverError(
        RESOLVER,
        `HTTP ${response.status}`,
        isRetryableStatus(response.status),
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(response.text);
    } catch {
      throw new MetadataResolverError(RESOLVER, 'response is not JSON', false);
    }
    const parsed = workSchema.safeParse(json);
    if (!parsed.success) throw new MetadataResolverError(RESOLVER, 'unexpected shape', false);
    const work = parsed.data.message;
    const date =
      work.published ?? work['published-print'] ?? work['published-online'] ?? work.issued;
    return {
      title: cleanText(work.title?.[0], MAX_TITLE_LENGTH),
      authors: (work.author ?? [])
        .map((a) =>
          cleanText(a.name ?? [a.given, a.family].filter(Boolean).join(' '), MAX_AUTHOR_LENGTH),
        )
        .filter((name): name is string => name !== null)
        .slice(0, MAX_AUTHORS),
      source: cleanText(work['container-title']?.[0] ?? work.publisher, MAX_SOURCE_LENGTH),
      publishedOn: isoDateFromParts(date?.['date-parts']?.[0]),
      abstract: cleanText(work.abstract, MAX_SUMMARY_LENGTH),
    };
  }
}
