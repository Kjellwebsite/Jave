import { MINUTE } from '../kernel/clock';

/** Inbound webhook bodies above this size are refused with 413 (the route should also cap reads). */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/** JAVE v1 signatures must be timestamped within ± this window (replay defense). */
export const REPLAY_WINDOW_MS = 5 * MINUTE;

/** Invalid-signature audit entries per integration per window (flood guard). */
export const INVALID_SIGNATURE_AUDITS_PER_WINDOW = 20;
export const INVALID_SIGNATURE_AUDIT_WINDOW_SECONDS = 60;

/** Nesting deeper than this is refused as malformed (bounded recursion). */
export const MAX_JSON_DEPTH = 64;

/** Longest accepted delivery / event identifier from a sender. */
export const MAX_DELIVERY_ID_LENGTH = 128;

export const PROCESS_DELIVERY_JOB = 'integrations.process_delivery';
export const PROCESS_DELIVERY_MAX_ATTEMPTS = 6;

export const DELIVER_OUTBOUND_JOB = 'integrations.deliver_outbound';
export const OUTBOUND_MAX_ATTEMPTS = 6;
export const OUTBOUND_TIMEOUT_MS = 10_000;
/** An outbound subscription is disabled (and audited) after this many failures in a row. */
export const OUTBOUND_MAX_CONSECUTIVE_FAILURES = 10;
export const OUTBOUND_USER_AGENT = 'JAVE-Webhooks/0.1';

/** Generated signing secrets: 32 random bytes, base64url, with a recognizable prefix. */
export const SIGNING_SECRET_BYTES = 32;
export const SIGNING_SECRET_PREFIX = 'whsec_';

/** Stored error strings are truncated to this length. */
export const MAX_ERROR_LENGTH = 500;

/** webhook_deliveries.status_reason column width. */
export const MAX_STATUS_REASON_LENGTH = 200;
