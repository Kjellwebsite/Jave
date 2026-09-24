import { z } from 'zod';
import { evidenceLevel, researchStatus } from '@jave/database';
import { pageSchema } from '../kernel/pagination';
import {
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_ATTACHMENTS,
  MAX_AUTHOR_LENGTH,
  MAX_AUTHORS,
  MAX_MESSAGE_CONTENT_LENGTH,
  MAX_REVIEW_NOTE_LENGTH,
  MAX_SEARCH_LENGTH,
  MAX_SOURCE_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  MAX_TOPIC_LENGTH,
  MAX_URL_LENGTH,
} from './constants';
import { hasEmbeddedCredentials, normalizeArxivId, normalizeDoi } from './extraction';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID');

export const httpUrlSchema = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL')
  .refine((value) => !hasEmbeddedCredentials(value), 'must not contain a username or password');

const doiSchema = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .transform((value, ctx) => {
    const doi = normalizeDoi(value);
    if (!doi) {
      ctx.addIssue({ code: 'custom', message: 'must be a DOI like 10.1234/abcd' });
      return z.NEVER;
    }
    return doi;
  });

const arxivSchema = z
  .string()
  .trim()
  .max(64)
  .transform((value, ctx) => {
    const id = normalizeArxivId(value);
    if (!id) {
      ctx.addIssue({ code: 'custom', message: 'must be an arXiv ID like 2401.01234' });
      return z.NEVER;
    }
    return id;
  });

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(MAX_TAG_LENGTH)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.+-]*$/u, 'tags use letters, numbers, spaces and - _ . +');

const tagsSchema = z
  .array(tagSchema)
  .max(MAX_TAGS, `at most ${MAX_TAGS} tags`)
  .transform((tags) => [...new Set(tags)]);

const authorsSchema = z.array(z.string().trim().min(1).max(MAX_AUTHOR_LENGTH)).max(MAX_AUTHORS);

const publishedOnSchema = z.iso.date();

const titleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);
const topicSchema = z.string().trim().min(1).max(MAX_TOPIC_LENGTH);
const summarySchema = z.string().trim().max(MAX_SUMMARY_LENGTH);
const sourceSchema = z.string().trim().min(1).max(MAX_SOURCE_LENGTH);

export const saveResearchItemSchema = z
  .object({
    title: titleSchema.optional(),
    authors: authorsSchema.optional(),
    source: sourceSchema.optional(),
    url: httpUrlSchema.optional(),
    doi: doiSchema.optional(),
    arxivId: arxivSchema.optional(),
    topic: topicSchema.optional(),
    tags: tagsSchema.optional(),
    summary: summarySchema.optional(),
    publishedOn: publishedOnSchema.optional(),
  })
  .refine(
    (data) => data.title || data.url || data.doi || data.arxivId,
    'Provide a title, URL, DOI or arXiv ID.',
  );

const discordMessageUrl = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(?:\d{17,20}|@me)\/\d{17,20}\/(\d{17,20})$/,
    'must be a Discord message link',
  );

export const saveFromMessageSchema = z
  .object({
    content: z.string().max(MAX_MESSAGE_CONTENT_LENGTH),
    messageUrl: discordMessageUrl,
    messageId: snowflake,
    attachments: z
      .array(
        z.object({
          url: httpUrlSchema,
          filename: z.string().trim().min(1).max(MAX_ATTACHMENT_NAME_LENGTH),
          contentType: z.string().max(100).optional(),
        }),
      )
      .max(MAX_ATTACHMENTS)
      .optional(),
  })
  .refine((data) => data.messageUrl.endsWith(`/${data.messageId}`), {
    message: 'messageUrl does not point to messageId',
    path: ['messageUrl'],
  });

export const updateResearchItemSchema = z
  .object({
    itemId: z.uuid(),
    title: titleSchema.optional(),
    authors: authorsSchema.optional(),
    source: sourceSchema.nullable().optional(),
    url: httpUrlSchema.nullable().optional(),
    doi: doiSchema.nullable().optional(),
    arxivId: arxivSchema.nullable().optional(),
    topic: topicSchema.nullable().optional(),
    tags: tagsSchema.optional(),
    summary: summarySchema.nullable().optional(),
    publishedOn: publishedOnSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).some((key) => key !== 'itemId'), 'Nothing to update.');

/** Statuses a reviewer can set. Archiving has its own service; NEW is never set by hand. */
export const reviewStatusSchema = z.enum(['needs_review', 'reviewed', 'verified']);

export const reviewResearchItemSchema = z
  .object({
    itemId: z.uuid(),
    status: reviewStatusSchema.optional(),
    evidenceLevel: z.enum(evidenceLevel.enumValues).optional(),
    topic: topicSchema.nullable().optional(),
    tags: tagsSchema.optional(),
    summary: summarySchema.nullable().optional(),
    note: z.string().trim().max(MAX_REVIEW_NOTE_LENGTH).optional(),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.evidenceLevel !== undefined ||
      data.topic !== undefined ||
      data.tags !== undefined ||
      data.summary !== undefined,
    'Nothing to review.',
  );

export const archiveResearchItemSchema = z.object({
  itemId: z.uuid(),
  reason: z.string().trim().max(MAX_REVIEW_NOTE_LENGTH).optional(),
});

export const itemIdSchema = z.object({ itemId: z.uuid() });

export const listResearchSchema = pageSchema.extend({
  status: z.enum(researchStatus.enumValues).optional(),
  topic: topicSchema.optional(),
  tag: tagSchema.optional(),
  q: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).optional(),
  mine: z.boolean().default(false),
});

export type SaveResearchItemInput = z.input<typeof saveResearchItemSchema>;
export type SaveFromMessageInput = z.input<typeof saveFromMessageSchema>;
export type UpdateResearchItemInput = z.input<typeof updateResearchItemSchema>;
export type ReviewResearchItemInput = z.input<typeof reviewResearchItemSchema>;
export type ListResearchInput = z.input<typeof listResearchSchema>;
