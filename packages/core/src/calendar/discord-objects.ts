/**
 * Compare-and-set for Discord objects the bot reports back (scheduled events,
 * announcement and game messages). Pure.
 *
 * Several sync jobs for one entity can overlap (one per revision, refreshes,
 * `runNow` next to the poll loop, two bot processes during a deploy). Each run
 * reports the object it created together with the id it saw when it decided
 * to create (`replaces`: null for a first create, the old id for a re-create).
 * Only a run that saw the current id may store its object; a run that lost the
 * race is told to delete its duplicate. Reporting the stored id again (a
 * retried callback) is a no-op, never a discard.
 */
export type DiscordObjectVerdict = 'store' | 'keep' | 'discard';

export function discordObjectVerdict(
  stored: string | null,
  reported: string,
  replaces: string | null,
): DiscordObjectVerdict {
  if (stored === reported) return 'keep';
  return stored === replaces ? 'store' : 'discard';
}
