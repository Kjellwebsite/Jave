import { z } from 'zod';

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type PageInput = z.input<typeof pageSchema>;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
