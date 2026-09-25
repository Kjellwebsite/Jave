import { z } from 'zod';
import type { Item } from '../types';

const irt = z.object({
  a: z.number().positive().max(5),
  b: z.number().min(-5).max(6),
  c: z.number().min(0).max(0.5),
  calibration: z.enum(['provisional', 'calibrated']),
});

const response = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('choice'), options: z.number().int().min(2).max(16) }),
  z.object({ kind: z.literal('number'), min: z.number(), max: z.number() }),
  z.object({ kind: z.literal('text'), maxLength: z.number().int().positive(), charset: z.enum(['letters', 'alnum', 'any']) }),
]);

export const itemSchema = z.object({
  id: z.string().min(3),
  version: z.number().int().positive(),
  paradigm: z.string(),
  domain: z.string(),
  facet: z.string(),
  level: z.number(),
  band: z.enum(['foundation', 'standard', 'advanced', 'elite', 'apex']),
  irt,
  timeLimitMs: z.number().int().min(5_000).max(600_000),
  response,
  content: z.unknown(),
  key: z.unknown(),
  features: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  source: z.union([
    z.object({ kind: z.literal('generated'), generator: z.string(), seed: z.number() }),
    z.object({ kind: z.literal('authored'), author: z.string(), reviewed: z.literal(true) }),
  ]),
});

/** Structural validation plus key/response consistency. Returns a list of problems (empty = valid). */
export function validateItem(item: Item): string[] {
  const parsed = itemSchema.safeParse(item);
  const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const r = item.response;
  if (r.kind === 'choice' && !(Number.isInteger(item.key) && (item.key as number) >= 0 && (item.key as number) < r.options)) issues.push('key: not a valid option index');
  if (r.kind === 'number' && !(typeof item.key === 'number' && item.key >= r.min && item.key <= r.max)) issues.push('key: outside the numeric range');
  if (r.kind === 'text' && !(typeof item.key === 'string' && item.key.length > 0 && item.key.length <= r.maxLength)) issues.push('key: invalid text key');
  return issues;
}
