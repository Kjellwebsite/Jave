# Research — SIDUS SCIENCE library (`packages/core/src/research`)

A shared, reviewed library of research references. A Discord message (or a dashboard form,
or a confirmed AI proposal) becomes a research item; reviewers set its status and evidence
level; verified items can be pushed to SIDUS SCIENCE.

`import { research } from '@jave/core'`

## Data

`research_items`: title (≤ 300, `title_guessed` while heuristic), authors (≤ 50), source/venue,
url, canonical_url, doi, arxiv_id, topic, tags (≤ 10), summary (≤ 4000), evidence level
(`unknown`, `anecdotal`, `observational`, `experimental`, `peer_reviewed`, `meta_analysis`),
status, published_on, submitter, reviewer, Discord message id/url, enrichment status/error,
Sidus sync status/external id/error. Unique indexes on `doi`, `arxiv_id`, `canonical_url`,
`discord_message_id` back the dedupe rules.

## State machine

```
NEW ──enrichment job──► NEEDS REVIEW ──► REVIEWED ──► VERIFIED
 │                          ▲   │           │  ▲          │
 │                          │   └───────────┼──┘          │
 └──────────────── any state ──archive──► ARCHIVED ──restore (reviewer)──► NEEDS REVIEW
```

Allowed reviewer transitions: `new → needs_review|reviewed|verified|archived`,
`needs_review → reviewed|verified|archived`, `reviewed → needs_review|verified|archived`,
`verified → needs_review|reviewed|archived`, `archived → needs_review`. NEW is never set by hand.
VERIFIED requires an evidence level other than `unknown`.

## Extraction (pure, `extraction.ts`)

- **DOI:** `10.<4–9 digits>/<suffix>`, also from `doi:` prefixes and `doi.org` links (URL-decoded).
  Trailing punctuation and unbalanced brackets are trimmed; publisher suffixes (`/abstract`,
  `/full`, `/pdf`, …) dropped; inside URLs only the **path** is searched (never query or
  fragment). Lower-cased (DOIs are case-insensitive).
- **arXiv:** only with an `arXiv:` prefix or an arxiv.org `abs|pdf|html` link (bare numbers are
  ignored). New scheme `YYMM.NNNN` (0704–1412) / `YYMM.NNNNN` (1501+), old scheme
  `archive(.SC)/YYMMNNN` (1991–2007); months validated; versions stripped.
- **URLs:** http(s) only, ≤ 2048 chars, ≤ 20 per message, Discord `<…>` and markdown wrappers
  removed, embedded `user:password@` credentials stripped (explicit URLs with credentials are
  rejected by validation). **Canonical URL** (dedupe key): lowercase host, credentials removed, fragment
  removed, `utm_*`, `fbclid`, `gclid` and other click trackers removed, query sorted, trailing
  slash removed; arXiv and doi.org links collapse to `https://arxiv.org/abs/<id>` /
  `https://doi.org/<doi>`. Discord links are never canonical references.
- **Title guess:** first line with ≥ 8 characters after removing links, identifiers, mentions,
  emoji and markdown; then the attachment filename; then `DOI …` / `arXiv:…` / URL slug.

## Services

| Service                                                             | Who                                                                                        | Notes                                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveResearchItem(input, { origin })`                               | Members in good standing with `canViewMembers`                                             | Needs one of title/url/doi/arxivId. Derives DOI/arXiv from the URL.                                                                                               |
| `saveFromMessage({ content, messageUrl, messageId, attachments? })` | same                                                                                       | `messageUrl` must be a Discord message link ending in `messageId`. One item per message.                                                                          |
| `updateResearchItem`                                                | Submitter (until VERIFIED; a REVIEWED item returns to NEEDS REVIEW) or `canReviewResearch` | Not for archived items. Duplicate DOI/URL → `ConflictError`. Reviewer edits of others' items are audited.                                                         |
| `reviewResearchItem`                                                | `canReviewResearch`, **never on your own submission** (blocked + audited)                  | status, evidence level, topic, tags, summary, note.                                                                                                               |
| `archiveResearchItem`                                               | Submitter or `canReviewResearch`                                                           | Audited.                                                                                                                                                          |
| `requestSidusSync`                                                  | `canReviewResearch`, VERIFIED items only                                                   | Queues `research.sync_sidus`. Audited.                                                                                                                            |
| `getResearchItem`, `listResearchItems`                              | `canViewMembers`                                                                           | Filters: status, topic (case-insensitive), tag, `q` (title/summary/DOI, LIKE-escaped), `mine`; pagination. Archived items only for their submitter and reviewers. |

Reviews and edits are guarded optimistically (`WHERE status = <status read>`): a concurrent
change returns `ConflictError` instead of, for example, verifying twice or editing an item that
was verified meanwhile.

Saves dedupe by DOI, arXiv id, canonical URL or Discord message id and return
`{ item, duplicate: true }` for an existing item; concurrent saves of the same reference are
resolved with a savepoint and the unique indexes.

## Events

| Event                | When                                           | subjectMemberId    |
| -------------------- | ---------------------------------------------- | ------------------ |
| `research.submitted` | New item saved (payload: origin, doi, arxivId) | submitter's member |
| `research.reviewed`  | Every review                                   | submitter's member |
| `research.verified`  | Item became VERIFIED                           | submitter's member |

## Audit actions

`research.reviewed`, `research.self_review_blocked` (durable, denied), `research.updated`
(reviewer edits), `research.archived`, `research.sidus_sync_requested`.

## Notifications

`research.reviewed` → submitter when their item becomes REVIEWED or VERIFIED
("RESEARCH VERIFIED — <title> — evidence: PEER REVIEWED.").

## Jobs

| Job                   | Enqueued by                                                                                                               | Work                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `research.enrich`     | every new item (dedupe `research:enrich:<id>`, 3 attempts)                                                                | Crossref for DOIs, arXiv for arXiv ids. Fills only missing fields (a guessed title yields to the source title). Outcomes: `enriched`, `not_found`, `skipped`, `failed` (after the last attempt, or at once for bad data). Moves NEW → NEEDS REVIEW. Idempotent. |
| `research.sync_sidus` | verification with `settings.integrations.sidusAutoSync`, or `requestSidusSync` (dedupe `research:sidus:<id>`, 5 attempts) | `pending → synced` (external id stored), `not_synced` (not configured, or no longer VERIFIED — reason recorded), `failed` (non-retryable error or last attempt). Never faked.                                                                                   |

Resolvers use an injectable `fetch`, an 8 s timeout, response caps (Crossref 512 KB, arXiv
256 KB), no redirects, and fail gracefully when the network is blocked.

## Discord

There is no Discord job in this module. The bot's surface (a message context-menu action,
for example) calls `saveFromMessage` with the content, link, id and attachments **as received
from the gateway**. `saveFromMessage` must only be exposed on the Discord surface: the service
cannot verify that the content really belongs to that message id. Reply with the item and the
`duplicate` flag, using `sanitizeForDiscord` / `userText` for titles.

## SIDUS SCIENCE API contract

JAVE is the client. Base URL from `SIDUS_API_URL` (https, or http on loopback; no embedded
credentials), key from `SIDUS_API_KEY`. No redirects are followed. Responses over 64 KB are
rejected. Timeout 10 s.

**Upsert a verified item** — idempotent:

```
PUT {SIDUS_API_URL}/v1/research-items/by-external-ref/{externalRef}
Authorization: Bearer {SIDUS_API_KEY}
Content-Type: application/json
Accept: application/json

{
  "externalRef": "<JAVE research item UUID — the upsert key>",
  "title": "string",
  "authors": ["string"],
  "doi": "10.xxxx/… | null",
  "arxivId": "2401.01234 | null",
  "url": "https://… | null",            // never a Discord link
  "canonicalUrl": "https://… | null",   // never a Discord link
  "topic": "string | null",
  "tags": ["string"],
  "summary": "string | null",
  "evidenceLevel": "unknown|anecdotal|observational|experimental|peer_reviewed|meta_analysis",
  "publishedOn": "YYYY-MM-DD | null",
  "verifiedAt": "ISO-8601 | null",
  "source": "jave"
}
```

Expected responses:

| Status                          | Body                        | JAVE behaviour                                         |
| ------------------------------- | --------------------------- | ------------------------------------------------------ |
| `200` / `201`                   | `{ "id": "<1–128 chars>" }` | `synced`, `sidus_external_id = id`                     |
| `401` / `403`                   | any                         | `failed` ("Sidus rejected the credentials."), no retry |
| `400/404/409/422`               | any                         | `failed`, no retry                                     |
| `408/429/5xx`, network, timeout | any                         | retried with backoff; `failed` after the 5th attempt   |
| `2xx` with another shape        | —                           | `failed` ("unexpected response"), no retry             |

**Health:** `GET {SIDUS_API_URL}/v1/health` with the same bearer header; any `2xx` is healthy.

No member identity (user ids, member ids, Discord ids, names) is ever sent to Sidus.

## Extension points

- **Metadata sources:** implement `MetadataResolver { name, kind: 'doi' | 'arxiv', resolve(id) }`
  (return `null` for not found; throw `MetadataResolverError` with `retryable`).
- **Sidus transport:** implement `SidusClient`. `createSidusClient({ baseUrl, apiKey, fetch })`
  returns `HttpSidusClient` when both are set, otherwise `NotConfiguredSidusClient`.
- **Wiring real Sidus credentials:** the static registry (`research.jobHandlers`) uses the public
  resolvers and the not-configured Sidus client because core cannot read the environment. The
  bot composition must use
  `research.createJobHandlers({ ...research.defaultResearchJobDeps(), sidus: research.createSidusClient({ baseUrl: env.SIDUS_API_URL, apiKey: env.SIDUS_API_KEY }) })`
  in place of the static research handlers (see known limitations).

## Known limitations

- `apps/bot` merges handler maps with duplicate detection, so replacing the static research
  handlers with the credentialed ones requires a small composition change at merge time.
- Un-verifying an item does not delete it from Sidus; the contract has no delete endpoint yet.
- Enrichment never overwrites member-provided fields and does not set a DOI found on arXiv.
- Discord CDN attachment links expire; items saved from attachments keep the message link as
  their durable reference.
- `saveFromMessage` trusts its caller for the content ↔ message-id binding (Discord surface only).
