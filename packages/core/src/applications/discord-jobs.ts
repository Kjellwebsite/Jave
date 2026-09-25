import { z } from 'zod';

/**
 * Discord job contract: the staff review card.
 *
 * Enqueued by every change a review card shows (submission, review start or
 * reassignment, each review, interview scheduling, decision, withdrawal after
 * submission). Each enqueue carries the application's new `revision`; the
 * dedupe key is per revision, so no update is ever dropped by a job that is
 * already running. Core may also enqueue a catch-up or repair render (same
 * payload shape) after a render finished behind or outlived its lease.
 *
 * Renders of one card are serialized by a lease in core: Discord applies
 * concurrent edits of one message in no guaranteed order, so a stale edit
 * could otherwise land last and leave live buttons on a decided card.
 *
 * The bot MUST, with the worker's system actor and `renderId = String(job.id)`:
 * 1. Call `applications.beginReviewCardRender(ctx, { applicationId, revision,
 *    renderId })`.
 *    - `{ outcome: 'superseded' }` → return `{ skipped: 'superseded' }`
 *      (a newer revision's job renders the newer state).
 *    - `{ outcome: 'no_channel' }` → return `{ skipped: 'no review channel' }`
 *      (no card exists yet and `channels.applicationsReview` is unset).
 *    - It throws ConflictError while another render holds the lease. Let it
 *      propagate: the queue retries with backoff.
 *    - `{ outcome: 'render', card }` → continue. From here until step 5, on
 *      any failure call `applications.releaseReviewCardRender(ctx,
 *      { applicationId, renderId })` (best effort) before rethrowing.
 * 2. If `card.message` is set, edit that message in `card.message.channelId`.
 *    If the message no longer exists (Discord 10008 Unknown Message) or its
 *    channel is gone (10003), fall through to posting a new one.
 * 3. Otherwise post a new message in `card.channelId` (the configured
 *    `channels.applicationsReview`). If the stored card was gone and no
 *    channel is configured, release the lease and return
 *    `{ skipped: 'no review channel' }`.
 * 4. Render one embed via `panel()`: title `APP-0042 — <STATUS>`, applicant
 *    display name and handle (never a mention that pings: send with
 *    `allowedMentions: { parse: [] }`), domain, submitted time, assigned
 *    reviewer, interview time, review tally, and the motivation / projects
 *    excerpts passed through `userText()`. Links are shown as plain text.
 *    Buttons come from `card.actions` (accept/reject only appear once a
 *    decision is possible), with custom ids
 *    `applications:<action>:<applicationId>` (`start_review`, `review`,
 *    `schedule_interview`, `accept`, `reject`) plus a dashboard link button
 *    when a public URL is configured. Custom ids route only; each button
 *    handler calls the matching service with the clicking user's actor, which
 *    re-checks capabilities.
 * 5. After posting OR editing, call
 *    `applications.recordReviewCardMessage(ctx, { applicationId, channelId,
 *    messageId, revision: card.revision, renderId })`. This releases the
 *    lease and enqueues any catch-up render itself. If the result's
 *    `discard` is non-null, delete that message (ignore 10008): a render
 *    that outlived its lease posted a duplicate.
 *
 * Required Discord permissions in the review channel: View Channel, Send
 * Messages, Embed Links, Read Message History. Editing and deleting the bot's
 * own messages needs nothing more. The channel must be private to staff who
 * hold canViewApplications: the card omits references and decision reasons,
 * but still shows applicant answers.
 *
 * Failures: missing access / unknown channel are permanent (dead-letter);
 * rate limits and 5xx retry with the queue's backoff.
 */
export const APPLICATION_REVIEW_CARD_JOB = 'discord.applications.review_card';

export const reviewCardJobPayloadSchema = z.object({
  applicationId: z.uuid(),
  /** The application's reviewCardRevision at enqueue time. */
  revision: z.number().int().min(1),
});

export type ReviewCardJobPayload = z.infer<typeof reviewCardJobPayloadSchema>;

/** Every Discord job type this module enqueues. */
export const APPLICATION_DISCORD_JOBS = [APPLICATION_REVIEW_CARD_JOB] as const;
