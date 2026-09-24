import { z } from 'zod';

/**
 * Discord job contract: the staff review card.
 *
 * Enqueued by every change a review card shows (submission, review start or
 * reassignment, each review, interview scheduling, decision, withdrawal after
 * submission). Each enqueue carries the application's new `revision`; the
 * dedupe key is per revision, so no update is ever dropped by a job that is
 * already running.
 *
 * The bot MUST:
 * 1. Load the card with `applications.getReviewCard(ctx, { applicationId })`
 *    (system actor). If `card.revision > payload.revision`, return
 *    `{ skipped: 'superseded' }` — a newer job renders the newer state.
 * 2. If `card.message` is set, edit that message in `card.message.channelId`.
 *    If the message no longer exists (Discord 10008 Unknown Message) or its
 *    channel is gone (10003), fall through to posting a new one.
 * 3. Otherwise post a new message in `card.channelId` (the configured
 *    `channels.applicationsReview`). If no channel is configured, return
 *    `{ skipped: 'no review channel' }`.
 * 4. Render one embed via `panel()`: title `APP-0042 — <STATUS>`, applicant
 *    display name and handle (never a mention that pings: send with
 *    `allowedMentions: { parse: [] }`), domain, submitted time, assigned
 *    reviewer, interview time, review tally, and the motivation / projects
 *    excerpts passed through `userText()`. Links are shown as plain text.
 *    Buttons come from `card.actions`, with custom ids
 *    `applications:<action>:<applicationId>` (`start_review`, `review`,
 *    `schedule_interview`, `accept`, `reject`) plus a dashboard link button
 *    when a public URL is configured. Custom ids route only; each button
 *    handler calls the matching service with the clicking user's actor, which
 *    re-checks capabilities.
 * 5. After posting OR editing, call
 *    `applications.recordReviewCardMessage(ctx, { applicationId, channelId,
 *    messageId, revision: card.revision })` (system actor). If the result's
 *    `discard` is non-null, delete that message (a concurrent render posted a
 *    duplicate; the callback picks the newest).
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
