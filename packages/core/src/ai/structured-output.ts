import { z } from 'zod';
import { missionType } from '@jave/database';
import { truncate } from '../kernel/redact';

/**
 * Tolerant parsing of JSON the model was asked to produce. Model output is
 * untrusted: every field is validated, capped, and URLs are restricted to
 * http(s). When parsing fails the caller falls back to plain text.
 */

const MAX_ANSWER_LENGTH = 8000;
const MAX_KEY_POINTS = 8;
const MAX_KEY_POINT_LENGTH = 500;
const MAX_CAVEATS_LENGTH = 2000;
const MAX_SOURCES = 6;
const MAX_SOURCE_TITLE_LENGTH = 300;
const MAX_SOURCE_NOTE_LENGTH = 500;
const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_ANNOUNCEMENT_TITLE_LENGTH = 100;
const MAX_ANNOUNCEMENT_BODY_LENGTH = 3500;
const MAX_TASK_TITLE_LENGTH = 120;
const MAX_TASK_BRIEF_LENGTH = 4000;
const FALLBACK_TASK_TITLE = 'Untitled mission';

/** Shown next to every model-suggested source. */
export const MODEL_SUGGESTED_LABEL = 'MODEL-SUGGESTED — UNVERIFIED' as const;

/** Pull the first JSON object out of text (handles ```json fences and chatter around it). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_SOURCE_URL_LENGTH) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

const cappedString = (max: number) =>
  z
    .string()
    .transform((value) => truncate(value.trim(), max))
    .catch('');

const researchSchema = z.object({
  answer: z.string().min(1),
  keyPoints: z.array(z.unknown()).catch([]).default([]),
  caveats: cappedString(MAX_CAVEATS_LENGTH).default(''),
  suggestedSources: z.array(z.unknown()).catch([]).default([]),
});

const sourceSchema = z.object({
  title: z.string().min(1),
  url: z.unknown().optional(),
  note: z.unknown().optional(),
});

export interface SuggestedSource {
  title: string;
  url: string | null;
  note: string;
  /** Always false: JAVE does not browse; the model may be wrong. */
  verified: false;
  label: typeof MODEL_SUGGESTED_LABEL;
}

export interface ResearchAnswer {
  answer: string;
  keyPoints: string[];
  caveats: string;
  suggestedSources: SuggestedSource[];
  /** False when the model did not return the requested JSON and the text is used as-is. */
  structured: boolean;
}

export function parseResearchAnswer(text: string): ResearchAnswer {
  const parsed = researchSchema.safeParse(extractJsonObject(text));
  if (!parsed.success) {
    return {
      answer: truncate(text.trim(), MAX_ANSWER_LENGTH),
      keyPoints: [],
      caveats: '',
      suggestedSources: [],
      structured: false,
    };
  }
  const data = parsed.data;
  return {
    answer: truncate(data.answer.trim(), MAX_ANSWER_LENGTH),
    keyPoints: data.keyPoints
      .filter((point): point is string => typeof point === 'string' && point.trim() !== '')
      .slice(0, MAX_KEY_POINTS)
      .map((point) => truncate(point.trim(), MAX_KEY_POINT_LENGTH)),
    caveats: data.caveats,
    suggestedSources: data.suggestedSources
      .flatMap((raw) => {
        const source = sourceSchema.safeParse(raw);
        if (!source.success) return [];
        return [
          {
            title: truncate(source.data.title.trim(), MAX_SOURCE_TITLE_LENGTH),
            url: safeHttpUrl(source.data.url),
            note:
              typeof source.data.note === 'string'
                ? truncate(source.data.note.trim(), MAX_SOURCE_NOTE_LENGTH)
                : '',
            verified: false as const,
            label: MODEL_SUGGESTED_LABEL,
          },
        ];
      })
      .slice(0, MAX_SOURCES),
    structured: true,
  };
}

export interface AnnouncementDraft {
  title: string;
  body: string;
}

const announcementSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

/** The model's announcement draft, or a plain-text fallback with a neutral title. */
export function parseAnnouncementDraft(text: string): AnnouncementDraft {
  const parsed = announcementSchema.safeParse(extractJsonObject(text));
  const draft = parsed.success ? parsed.data : { title: 'ANNOUNCEMENT', body: text.trim() };
  return {
    title: truncate(draft.title, MAX_ANNOUNCEMENT_TITLE_LENGTH),
    body: truncate(draft.body, MAX_ANNOUNCEMENT_BODY_LENGTH),
  };
}

export type TaskType = (typeof missionType.enumValues)[number];

export interface TaskDraft {
  title: string;
  brief: string;
  type: TaskType;
}

const taskSchema = z.object({
  title: z.string().trim().min(1),
  brief: z.string().trim().min(1),
  type: z.enum(missionType.enumValues).catch('individual').default('individual'),
});

/** The model's mission draft; an unknown type becomes `individual`, plain text becomes the brief. */
export function parseTaskDraft(text: string): TaskDraft {
  const parsed = taskSchema.safeParse(extractJsonObject(text));
  const draft = parsed.success
    ? parsed.data
    : { title: FALLBACK_TASK_TITLE, brief: text.trim(), type: 'individual' as const };
  return {
    title: truncate(draft.title, MAX_TASK_TITLE_LENGTH),
    brief: truncate(draft.brief, MAX_TASK_BRIEF_LENGTH),
    type: draft.type,
  };
}
