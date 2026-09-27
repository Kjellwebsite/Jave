import type { APIEmbed, APISelectMenuOption } from 'discord.js';
import { achievements, loadCatalog, missions, ValidationError } from '@jave/core';
import type { HandlerContext, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, panel, row, stringSelect, success } from '../../ui/components';
import { plainText } from '../../ui/format';
import { GLYPH, LIMITS } from '../../ui/theme';
import { missionHeadline, MISSIONS_NS, rewardTitle, TYPE_LABEL } from './render';
import { ensureManager } from './staff-access';
import { detailPayload } from './views';

/**
 * The SETTINGS panel: the mission options a modal cannot hold (capability,
 * reward, type, evidence, self-assignment), as selects and toggles. Every
 * change goes through updateMission as the clicking user.
 */

/** Select value for "none": never a valid facet or achievement key. */
export const NONE_VALUE = '-';
const OPTION_TEXT_MAX = 100;
/** One option is reserved for "none". */
const CHOICES_MAX = LIMITS.selectOptions - 1;

function option(label: string, value: string, current: boolean, description?: string) {
  const entry: APISelectMenuOption = {
    label: plainText(label, OPTION_TEXT_MAX),
    value,
    default: current,
  };
  if (description) entry.description = plainText(description, OPTION_TEXT_MAX);
  return entry;
}

async function facetOptions(h: HandlerContext, current: string | null) {
  const catalog = await loadCatalog(h.ctx);
  const domains = new Map(catalog.domains.map((domain) => [domain.key, domain.label]));
  return [
    option('No capability', NONE_VALUE, current === null),
    ...catalog.facets
      .slice(0, CHOICES_MAX)
      .map((facet) =>
        option(
          `${(domains.get(facet.domainKey) ?? facet.domainKey).toUpperCase()} ${GLYPH.bar} ${facet.label}`,
          facet.key,
          facet.key === current,
        ),
      ),
  ];
}

async function rewardOptions(h: HandlerContext, current: string | null) {
  // Mission staff are achievement staff: hidden definitions arrive unmasked.
  const catalog = await achievements.getAchievementCatalog(h.ctx);
  const visible = catalog.flatMap((entry) => (entry.masked ? [] : [entry]));
  const ordered = [
    ...visible.filter((entry) => entry.key === current),
    ...visible.filter((entry) => entry.key !== current),
  ];
  const shown = ordered.slice(0, CHOICES_MAX);
  return {
    options: [
      option('No reward', NONE_VALUE, current === null),
      ...shown.map((entry) =>
        option(
          entry.title.toUpperCase(),
          entry.key,
          entry.key === current,
          `${entry.rarity.toUpperCase()}${entry.visibility === 'hidden' ? ` ${GLYPH.dot} HIDDEN` : ''} ${GLYPH.dot} ${entry.summary}`,
        ),
      ),
    ],
    truncated: ordered.length > shown.length,
  };
}

function settingsEmbed(mission: missions.MissionSummary, facetLabel: string | null): APIEmbed {
  return panel({
    kicker: `MISSION ${mission.number} ${GLYPH.dot} SETTINGS`,
    title: plainText(mission.title, missions.TITLE_MAX),
    description: 'Changes apply immediately. A posted card follows them.',
    fields: [
      field('Type', TYPE_LABEL[mission.type], true),
      field('Capability', facetLabel ?? GLYPH.unknown, true),
      field('Reward', rewardTitle(mission.reward) ?? GLYPH.unknown, true),
      field('Evidence', mission.evidenceRequired ? 'Required' : 'Optional', true),
      field(
        'Self-assign',
        mission.type === 'team'
          ? 'Off (teams are formed by staff)'
          : mission.selfAssignable
            ? 'On'
            : 'Off',
        true,
      ),
    ],
  });
}

export async function settingsPayload(
  h: HandlerContext,
  missionId: string,
  notice?: APIEmbed,
): Promise<ReplyPayload> {
  const { mission } = await missions.getMissionDetail(h.ctx, { missionId });
  const id = mission.id;
  const [facets, rewards, catalog] = await Promise.all([
    facetOptions(h, mission.facetKey),
    rewardOptions(h, mission.reward && !mission.reward.hidden ? mission.reward.key : null),
    loadCatalog(h.ctx),
  ]);
  const facetLabel = catalog.facets.find((facet) => facet.key === mission.facetKey)?.label ?? null;
  const components: NonNullable<ReplyPayload['components']> = [
    row(stringSelect(customId(MISSIONS_NS, 'set_facet', id), 'Capability', facets)),
    row(
      stringSelect(
        customId(MISSIONS_NS, 'set_reward', id),
        rewards.truncated ? 'Reward (more in the dashboard)' : 'Reward achievement',
        rewards.options,
      ),
    ),
  ];
  if (mission.status === 'draft') {
    components.push(
      row(
        stringSelect(
          customId(MISSIONS_NS, 'set_type', id),
          'Type',
          missions.MISSION_TYPES.map((type) =>
            option(TYPE_LABEL[type], type, type === mission.type),
          ),
        ),
      ),
    );
  }
  const toggles = [
    button(
      mission.evidenceRequired ? 'Evidence: required' : 'Evidence: optional',
      customId(MISSIONS_NS, 'toggle_evidence', id),
    ),
  ];
  if (mission.type !== 'team') {
    toggles.push(
      button(
        mission.selfAssignable ? 'Self-assign: on' : 'Self-assign: off',
        customId(MISSIONS_NS, 'toggle_self', id),
      ),
    );
  }
  toggles.push(button('Back', customId(MISSIONS_NS, 'view_here', id)));
  components.push(row(...toggles));
  const embed = settingsEmbed(mission, facetLabel);
  return { embeds: notice ? [notice, embed] : [embed], components, ephemeral: true };
}

export async function openSettings(h: HandlerContext, missionId: string): Promise<void> {
  if (!(await ensureManager(h))) return;
  await h.interaction.update(await settingsPayload(h, missionId));
}

type Patch = NonNullable<Parameters<typeof missions.updateMission>[1]['patch']>;

async function applyPatch(h: HandlerContext, missionId: string, patch: Patch, what: string) {
  const updated = await missions.updateMission(h.ctx, { missionId, patch });
  const notice = success(
    `${what} updated`,
    `${missionHeadline(missions.formatMissionNumber(updated.number), updated.title)}.`,
  );
  await h.interaction.update(await settingsPayload(h, missionId, notice));
}

function chosenValue(h: HandlerContext): string | null {
  const [value] = h.interaction.values;
  if (value === undefined) throw new ValidationError('Choose an option.');
  return value === NONE_VALUE ? null : value;
}

/** A settings select or toggle; `action` comes from the custom id. */
export async function changeSetting(
  h: HandlerContext,
  action: string,
  missionId: string,
): Promise<boolean> {
  switch (action) {
    case 'set_facet':
      await applyPatch(h, missionId, { facetKey: chosenValue(h) }, 'Capability');
      return true;
    case 'set_reward':
      await applyPatch(h, missionId, { rewardAchievementKey: chosenValue(h) }, 'Reward');
      return true;
    case 'set_type': {
      const type = missions.MISSION_TYPES.find((candidate) => candidate === chosenValue(h));
      if (!type) throw new ValidationError('type: choose a mission type');
      await applyPatch(h, missionId, { type }, 'Type');
      return true;
    }
    case 'toggle_evidence':
    case 'toggle_self': {
      const { mission } = await missions.getMissionDetail(h.ctx, { missionId });
      const patch: Patch =
        action === 'toggle_evidence'
          ? { evidenceRequired: !mission.evidenceRequired }
          : { selfAssignable: !mission.selfAssignable };
      await applyPatch(
        h,
        missionId,
        patch,
        action === 'toggle_evidence' ? 'Evidence' : 'Self-assign',
      );
      return true;
    }
    default:
      return false;
  }
}

/** BACK from the settings panel: the detail view, in place. */
export async function backToDetail(h: HandlerContext, missionId: string): Promise<void> {
  await h.interaction.update(await detailPayload(h, missionId));
}
