import type { z } from 'zod';
import { ValidationError } from './errors';

/** Parse input with a zod schema, converting failures to a ValidationError. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    const first = issues[0];
    const message = first
      ? `${first.path ? `${first.path}: ` : ''}${first.message}`
      : 'Invalid input.';
    throw new ValidationError(message, issues);
  }
  return result.data;
}
