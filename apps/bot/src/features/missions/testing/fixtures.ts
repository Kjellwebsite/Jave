import { eq } from 'drizzle-orm';
import { jobs } from '@jave/database';
import { missions, type UserActor } from '@jave/core';
import type { BotHarness } from '../../../testing/harness';
import type { FakeInteraction } from '../../../testing/fake-interaction';
import type { ModalPayload } from '../../../interactions/types';

/** Missions suites run a full database per test; generous timeouts keep a busy machine green. */
export const SUITE_TIMEOUTS = { testTimeout: 120_000, hookTimeout: 240_000 };

export const BRIEF = 'Ship a working prototype and document what you learned along the way.';
export const EVIDENCE_URL = 'https://example.com/prototype';
export const CHANNEL = '400000000000000011';

export type MissionInput = Parameters<typeof missions.createMission>[1];

/** Create and publish a mission through core, without an announcement. */
export async function openMission(
  bot: BotHarness,
  staff: UserActor,
  overrides: Partial<MissionInput> = {},
): Promise<missions.MissionRecord> {
  const draft = await missions.createMission(bot.kit.as(staff), {
    title: 'Prototype sprint',
    brief: BRIEF,
    type: 'build',
    evidenceRequired: false,
    ...overrides,
  });
  const { mission } = await missions.publishMission(bot.kit.as(staff), {
    missionId: draft.id,
    announce: false,
  });
  return mission;
}

/** Every custom id on the last payload, in order. */
export function customIds(interaction: FakeInteraction): string[] {
  const payload = interaction.lastPayload();
  return (payload?.components ?? []).flatMap((row) =>
    row.components.map((component) => ('custom_id' in component ? component.custom_id : '')),
  );
}

/** Button labels on the last payload. */
export function labels(interaction: FakeInteraction): string[] {
  const payload = interaction.lastPayload();
  return (payload?.components ?? []).flatMap((row) =>
    row.components.flatMap((component) =>
      'label' in component && typeof component.label === 'string' ? [component.label] : [],
    ),
  );
}

export function modalOf(interaction: FakeInteraction): ModalPayload | null {
  const response = interaction.responses.find((r) => r.type === 'modal');
  return response && response.type === 'modal' ? response.modal : null;
}

export async function jobStatuses(bot: BotHarness, type: string): Promise<string[]> {
  const rows = await bot.kit.db.select().from(jobs).where(eq(jobs.type, type));
  return rows.map((row) => row.status);
}
