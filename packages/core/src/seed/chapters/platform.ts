import { seedStarterAchievements } from '../../achievements';
import { updateSettings } from '../../settings/settings.service';
import { seedStarterTemplates } from '../../trials';
import { snowflakeAt } from '../cast';
import type { Story } from '../story';

/**
 * Platform setup on day one: the starter achievement catalog, the curated
 * trial templates, and the ticket channels.
 *
 * DEVELOPMENT DATA: the ticket channels point at placeholder Discord IDs of
 * the fictional JAVELIN server, so tickets can be opened from the dashboard.
 * Before running the bot against a real guild, map real channels with
 * `/settings channel` (`/jave setup` flags the placeholders as missing).
 */
export const PLACEHOLDER_CHANNELS = {
  tickets: snowflakeAt('2025-12-01T00:00:00Z', 101),
  ticketArchive: snowflakeAt('2025-12-01T00:00:00Z', 102),
} as const;

export function setUpPlatform(story: Story): void {
  story.at(-150, 10, async (run) => {
    const founder = await run.as('founder');
    await seedStarterAchievements(founder);
    await seedStarterTemplates(await run.as('founder'));
    await updateSettings(await run.as('founder'), 'channels', PLACEHOLDER_CHANNELS);
  });
}
