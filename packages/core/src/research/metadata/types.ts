/** Bibliographic metadata returned by a resolver. Every field is already cleaned and capped. */
export interface ResolvedMetadata {
  title: string | null;
  authors: string[];
  /** Journal, venue or repository (e.g. "Nature", "arXiv"). */
  source: string | null;
  /** YYYY-MM-DD (day/month default to 01 when the source is less precise). */
  publishedOn: string | null;
  abstract: string | null;
}

export type IdentifierKind = 'doi' | 'arxiv';

/**
 * Extension point for metadata sources. Implementations must be side-effect
 * free, time out, cap response sizes, and never throw for "not found"
 * (return null instead).
 */
export interface MetadataResolver {
  readonly name: string;
  readonly kind: IdentifierKind;
  resolve(identifier: string): Promise<ResolvedMetadata | null>;
}

/** A resolver failure. `retryable` distinguishes outages from bad data. */
export class MetadataResolverError extends Error {
  readonly retryable: boolean;
  readonly resolver: string;
  constructor(resolver: string, reason: string, retryable: boolean) {
    super(`${resolver}: ${reason}`);
    this.name = 'MetadataResolverError';
    this.resolver = resolver;
    this.retryable = retryable;
  }
}
