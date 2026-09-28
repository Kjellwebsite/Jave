# Privacy: export, erasure, sessions

Module `@jave/core` `privacy` (`packages/core/src/privacy`). Surfaces: the dashboard's
**My profile → Privacy** tab and **Members → member → Account** tab. There is no Discord
command: a data file belongs in a browser download, not a DM.

## Sessions

| Service                                  | Who                                                                                       | What                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `listMySessions`                         | any signed-in account                                                                     | Your live sessions: created, last seen, expiry, user agent. Never token or IP hashes.           |
| `revokeMySession({ sessionId })`         | the session's owner                                                                       | Ends one session. Someone else's, or a finished one, is `NOT_FOUND`. Audited `session.revoked`. |
| `revokeUserSessions({ userId, reason })` | yourself; `canQuarantine` on accounts ranked strictly below you (reason required); system | Ends every live session of the account. Audited `session.revoked_all` with the count.           |

A **ban** ends the banned account's sessions (subscriber `privacy.end-sessions-on-ban` on
`moderation.case_created`). A quarantine does not: quarantined and banned members already hold
no capabilities from their next request on, and a release should not force a new sign-in.

## Export

`exportMemberData({ memberId?, reason? })` returns a JSON document
(`format: "jave.member-export"`, `version: 1`). Your own data needs only a signed-in account;
someone else's needs `canManagePrivacy` (founders) and a reason. Three exports per requester per
24 hours (`consumeRateLimit`). Audited `privacy.exported` (durable, `self` and the reason).

The export contains what JAVE shows the member about themselves:

| Section         | Contents                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `account`       | Discord identity, profile, preferences, notification settings, linked accounts (username only), dashboard sessions (no hashes)               |
| `roles`         | Role grants and revocations with dates                                                                                                       |
| `capability`    | Claimed and verified ranks, rank history (with reasons, as `/rank history` shows), submitted evidence, verification requests and decisions   |
| `applications`  | Every answer, the message reviewers sent, the status timeline                                                                                |
| `trials`        | Participation and statement, submissions they made, **published** results only                                                               |
| `work`          | Missions (their submissions, feedback shown to them), project memberships, contributions (with review notes, as shown to them), achievements |
| `community`     | Event RSVPs and teams, game results, referral code, counts of people they invited (never who), how they joined, research they saved          |
| `support`       | Tickets they opened, with the conversation as they saw it (internal notes excluded)                                                          |
| `moderation`    | Actions taken on them, with the reason they were sent (private staff notes excluded)                                                         |
| `notifications` | Up to 5,000, newest first                                                                                                                    |
| `ai`            | Requests per day and feature (prompts and answers are never stored), proposals they requested                                                |

`withheld` lists, with a count and a one-line reason, what staff hold that the file does not
contain: application reviews, staff notes, evaluator notes, trial evaluations, private moderation
notes, security events, audit entries about the account. A founder can answer a request for
those. **Adversarial records are never read, listed or counted** (their existence must not leak).

## Erasure

`eraseMember({ memberId, reason, confirmHandle })` — founders (`canManagePrivacy`), with a reason
and the member's current handle typed as confirmation. One transaction; audited `privacy.erased`
with the reason and per-step counts. Refused:

- for yourself (`FORBIDDEN`: another founder does it);
- while the member is **in the server** (`INVALID_STATE`: they would be re-created on their next
  interaction; they leave, or are removed, first);
- while they hold a **staff role** (`INVALID_STATE`: revoke it first);
- when the typed handle does not match (`VALIDATION`), or they were already erased (`CONFLICT`).

What happens, in order:

1. **Scrub kept records.** The person's names (Discord username and display name, profile display
   name, handle, linked GitHub usernames) are replaced with `Erased member` wherever kept records
   can mention them: every notification (any recipient), audit context and domain events about
   them or their records, their tickets' event log, live and dead job payloads, staff-written
   reasons and notes attached to their records (moderation cases, role grants, rank history,
   achievements, contributions, trial evaluations, verifications, application decisions, reviews
   and status notes). Their ticket subjects are replaced with `[erased]` in the same places.
   Whole words only, case-insensitive; names shorter than three characters only where they are
   the whole value. JSON keys are never touched.
2. **Erase what they wrote.** Application answers, references, evidence links and the reviewers'
   message; capability evidence; verification claims; trial statements; mission submissions;
   contributions (title `[erased]`, description, URL, external reference); their tickets'
   subjects, AI summaries and every message in them (including staff replies and internal notes,
   which are about them); staff notes about them; evaluator notes; message excerpts in security
   events; the text and payload of AI proposals they requested (a pending one expires).
3. **Delete what exists only for them.** Sessions, preferences, notification preferences,
   notifications addressed to them, linked accounts, rate-limit buckets; their referral code is
   deactivated.
4. **Pseudonymize the identity.** `users.username = 'erased'`, display name and avatar cleared;
   the member gets handle `erased-<8 random characters>`, display name `Erased member`, no
   headline, bio or primary domain, staff-only visibility, off leaderboards; both rows get
   `deleted_at`. Every role is revoked and a role sync is queued, so Discord follows.

**Kept**, pseudonymous, as the organization's record: the Discord ID (so a ban is re-applied when
the account rejoins, and the account is never silently re-created with its old history),
moderation cases, security events, rank history, capability ranks, trial participation and
results, team submissions (shared work, attributed only to the pseudonymous member), project
memberships, event RSVPs, game results, application decisions, referrals, AI usage counts, audit
logs, domain events and jobs (completed jobs are pruned after 14 days by housekeeping).

**Not reachable from JAVE:** messages and threads in Discord itself (ticket threads, transcripts
uploaded to the archive channel, posts in trial channels). Staff delete those in Discord when a
request covers them.

### Rejoining

An erased member who joins the server again starts over (`ensureMember` revives the row): a fresh
handle and name from their current Discord profile, onboarding from the start, the MEMBER role.
Their standing is kept, so a ban or quarantine is re-applied by join screening, and the records
erasure kept are theirs again. Audited `member.revived`.

## Tests

`packages/core/src/privacy/*.test.ts` on both backends:

- `erasure.test.ts` builds a member who used most of JAVE (every piece of text they wrote carries
  a `QZ-` marker, staff text names them), erases them, then scans **every text, varchar, JSON and
  array column of every table** (from the Drizzle schema, so new tables are covered without
  touching the test) for the markers and their names. Only completed job payloads may still
  match. Also: the refusals, the kept record, rejoining, and a ban surviving erasure.
- `export.test.ts`: contents, withheld staff-only writing and counts, no other member's private
  data, no hashes, founders' exports with a reason, the rate limit, the file name.
- `sessions.test.ts`: listing, ending one or all, the hierarchy rule, a ban ending sessions.
- `scrub.test.ts`: whole-word matching, short names, regex characters, JSON keys.
