/** Job types owned by the research module (non-Discord background work). */
export const RESEARCH_ENRICH_JOB = 'research.enrich';
export const RESEARCH_SYNC_SIDUS_JOB = 'research.sync_sidus';

export const ENRICH_MAX_ATTEMPTS = 3;
export const SIDUS_SYNC_MAX_ATTEMPTS = 5;

export const MAX_TITLE_LENGTH = 300;
export const MAX_SUMMARY_LENGTH = 4000;
export const MAX_SOURCE_LENGTH = 120;
export const MAX_TOPIC_LENGTH = 80;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 32;
export const MAX_AUTHORS = 50;
export const MAX_AUTHOR_LENGTH = 120;
export const MAX_URL_LENGTH = 2048;
export const MAX_DOI_LENGTH = 200;
export const MAX_REVIEW_NOTE_LENGTH = 1000;
/** Upper bound for a submitted item version (Postgres integer). */
export const MAX_ITEM_VERSION = 2_147_483_647;
export const MAX_SEARCH_LENGTH = 100;

/** Discord allows 4000 characters for boosted accounts; nothing longer is a real message. */
export const MAX_MESSAGE_CONTENT_LENGTH = 4000;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_NAME_LENGTH = 200;
/** URLs considered per message; the rest are ignored. */
export const MAX_URLS_PER_MESSAGE = 20;
/** Minimum length for a line to count as a title guess. */
export const MIN_TITLE_GUESS_LENGTH = 8;

/** Metadata resolver limits (Crossref, arXiv). */
export const METADATA_TIMEOUT_MS = 8000;
export const CROSSREF_MAX_BYTES = 512 * 1024;
export const ARXIV_MAX_BYTES = 256 * 1024;

/** Sidus client limits. */
export const SIDUS_TIMEOUT_MS = 10_000;
export const SIDUS_MAX_RESPONSE_BYTES = 64 * 1024;
export const MAX_SIDUS_EXTERNAL_ID_LENGTH = 128;
