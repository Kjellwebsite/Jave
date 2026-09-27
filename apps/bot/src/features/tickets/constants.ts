/** Custom-id namespace of the tickets feature (components and modals). */
export const TICKETS_NS = 'tickets';

/** Component and modal actions. Custom ids route; every handler re-checks the clicker in core. */
export const ACTION = {
  /** Category select (from /ticket open or the public panel) → open-ticket modal. */
  category: 'category',
  open: 'open',
  claim: 'claim',
  close: 'close',
  reopen: 'reopen',
  transfer: 'transfer',
  priority: 'priority',
  waiting: 'waiting',
  note: 'note',
  summary: 'summary',
  /** Queue select: claim the chosen ticket. */
  queueClaim: 'queue-claim',
  /** List select (/ticket mine, Member tickets): open the chosen ticket. */
  view: 'view',
  /** Staff panel with every handler control for one ticket (card and /ticket view). */
  manage: 'manage',
  unclaim: 'unclaim',
  resume: 'resume',
} as const;

/** Modal field ids. */
export const FIELD = {
  subject: 'subject',
  body: 'body',
  priority: 'priority',
  reason: 'reason',
  note: 'note',
} as const;

/**
 * Input caps shown in Discord's modals. Core validates the exact rules
 * (after normalization); these only stop oversized input at the source.
 */
export const INPUT_LIMITS = {
  subject: { min: 3, max: 120 },
  body: { min: 3, max: 4000 },
  reason: { min: 3, max: 500 },
  note: { min: 1, max: 4000 },
} as const;

/** Ticket rows listed in one ephemeral panel (/ticket mine, /ticket queue). */
export const LIST_LIMIT = 10;
/** Autocomplete choices Discord accepts. */
export const AUTOCOMPLETE_LIMIT = 25;
/** Tickets scanned when autocompleting by number. */
export const AUTOCOMPLETE_SCAN_LIMIT = 100;
/** Discord caps choice names and select labels at 100 characters. */
export const CHOICE_NAME_MAX = 100;
/** Subject excerpt in lists and choices. */
export const SUBJECT_EXCERPT = 60;
/** Subject shown on the card. */
export const CARD_SUBJECT_MAX = 200;
/** Opening-message excerpt on the card (after escaping). */
export const CARD_EXCERPT_MAX = 1500;
/** The handler's name in the CLAIMED announcement. */
export const ASSIGNEE_NAME_MAX = 64;
/** A one-line announcement (claim, waiting, reopen) in the thread. */
export const ANNOUNCEMENT_TEXT_MAX = 1500;
/** A close reason on the closing card. */
export const REASON_DISPLAY_MAX = 1000;
/** Discord's modal title limit. */
export const MODAL_TITLE_MAX = 45;
/** AI summary rendered in an embed description. */
export const SUMMARY_DISPLAY_MAX = 3500;

/**
 * Largest transcript JAVE uploads. Discord's default upload limit for bots is
 * 10 MiB; staying below it leaves room for the multipart envelope.
 */
export const TRANSCRIPT_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Ticket threads archive after a week without messages (Discord's longest
 * idle period), so a quiet requester still finds their thread in the list.
 * The jobs unarchive it whenever they need to act in it.
 */
export const THREAD_AUTO_ARCHIVE_MINUTES = 10080;

/** Discord error codes the ticket jobs react to. */
export const DISCORD_ERROR = {
  unknownChannel: 10003,
  unknownMember: 10007,
  unknownMessage: 10008,
  unknownUser: 10013,
  /** An edit or member add in an archived thread. */
  threadArchived: 50083,
} as const;

/** Audit-log reasons on Discord actions. */
export const DISCORD_REASON = {
  openThread: 'JAVE ticket opened',
  closeThread: 'JAVE ticket closed',
  reopenThread: 'JAVE ticket reopened',
  unarchiveThread: 'JAVE ticket update in an idle thread',
  duplicateThread: 'JAVE duplicate ticket thread (another run recorded the ticket first)',
} as const;
