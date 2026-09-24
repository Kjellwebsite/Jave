import { timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/** Timestamp with time zone, surfaced as a JS Date. */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const id = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () => ts('created_at').notNull().defaultNow();

export const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const deletedAt = () => ts('deleted_at');

/** Discord snowflake IDs are 64-bit integers; store them as text. */
export const snowflake = (name: string) => varchar(name, { length: 20 });
