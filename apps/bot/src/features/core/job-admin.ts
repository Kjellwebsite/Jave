import type { APIEmbed } from 'discord.js';
import { can, type JobSummary, listJobs, retryDeadJob, ValidationError } from '@jave/core';
import type { ComponentHandler, HandlerContext, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, failure, field, panel, row, stringSelect, success } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { fitLines, showPanel } from './settings-ui';

/**
 * Dead letters from /jave status: jobs that exhausted their attempts (or
 * failed permanently). Listing needs canViewSystemStatus; a retry re-runs the
 * side effect, so core requires canManageSettings and audits it.
 */

export const JOBS_NS = 'jobs';
/** Dead letters shown per panel: one line and one retry option each. */
const DEAD_JOBS_SHOWN = 10;
const JOB_TYPE_MAX = 64;
const ERROR_EXCERPT_MAX = 160;
/** Select option labels and descriptions are capped by Discord at 100 characters. */
const OPTION_TEXT_MAX = 100;
/** Job ids are bigserial; fifteen digits stay exact as a JavaScript number. */
const JOB_ID_PATTERN = /^\d{1,15}$/;

/** Dead letters in the queue (the status panel shows the button only when there are any). */
export async function deadJobCount(h: HandlerContext): Promise<number> {
  return (await listJobs(h.ctx, { status: 'dead', limit: 1 })).total;
}

export function deadJobsButton(count: number) {
  return button(`Dead letters ${GLYPH.dot} ${count}`, customId(JOBS_NS, 'dead'));
}

function jobLine(job: JobSummary): string {
  const error = job.lastError ? userText(job.lastError, ERROR_EXCERPT_MAX) : 'No error recorded.';
  return [
    `\`#${job.id}\` ${userText(job.type, JOB_TYPE_MAX)} ${GLYPH.dot} ${job.attempts}/${job.maxAttempts} attempts ${GLYPH.dot} ${discordTime(job.createdAt)}`,
    `${GLYPH.bar} ${error}`,
  ].join('\n');
}

async function renderDeadJobs(h: HandlerContext, notice?: APIEmbed): Promise<ReplyPayload> {
  const page = await listJobs(h.ctx, { status: 'dead', limit: DEAD_JOBS_SHOWN });
  const retryable = can(h.ctx, 'canManageSettings') && page.items.length > 0;
  const shown =
    page.total > page.items.length ? `Newest ${page.items.length} of ${page.total}.` : '';
  return {
    embeds: [
      ...(notice ? [notice] : []),
      panel({
        kicker: 'JAVE STATUS',
        title: 'Dead letters',
        description:
          page.items.length === 0
            ? 'None. Every background job completed or is still scheduled.'
            : [
                'Jobs that failed permanently or ran out of attempts. A retry re-runs the side effect against current state.',
                shown,
              ]
                .filter(Boolean)
                .join(' '),
        color: page.items.length === 0 ? COLORS.success : COLORS.warning,
        fields: page.items.length ? [field('Jobs', fitLines(page.items.map(jobLine)))] : [],
      }),
    ],
    components: [
      ...(retryable
        ? [
            row(
              stringSelect(
                customId(JOBS_NS, 'retry'),
                'Retry a job',
                page.items.map((job) => ({
                  label: clip(`#${job.id} ${job.type}`, OPTION_TEXT_MAX),
                  value: String(job.id),
                  description: clip(job.lastError ?? 'No error recorded.', OPTION_TEXT_MAX),
                })),
              ),
            ),
          ]
        : []),
      row(button('Refresh', customId(JOBS_NS, 'dead'))),
    ],
    ephemeral: true,
  };
}

function parseJobId(value: string | undefined): number {
  if (!value || !JOB_ID_PATTERN.test(value)) throw new ValidationError('Choose a job.');
  return Number(value);
}

/** The retried job runs right after this interaction (the router executes queued jobs). */
async function retry(h: HandlerContext, value: string | undefined): Promise<void> {
  const job = await retryDeadJob(h.ctx, { jobId: parseJobId(value) });
  await showPanel(
    h,
    await renderDeadJobs(
      h,
      success('Job requeued', `\`#${job.id}\` ${userText(job.type, JOB_TYPE_MAX)} runs again now.`),
    ),
  );
}

export const jobComponents: ComponentHandler = {
  namespace: JOBS_NS,
  async handle(h, action) {
    if (action === 'dead') return showPanel(h, await renderDeadJobs(h));
    if (action === 'retry') return retry(h, h.interaction.values[0]);
    await h.respond({
      embeds: [failure('EXPIRED', 'This control is no longer active.')],
      ephemeral: true,
    });
  },
};
