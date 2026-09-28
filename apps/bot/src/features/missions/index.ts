import { missions } from '@jave/core';
import type { ComponentHandler, HandlerContext, ModalHandler } from '../../interactions/types';
import { failure, panel } from '../../ui/components';
import type { BotFeature } from '../types';
import { assignOptionsFromModal, assignPicked, openAssign, openAssignOptions } from './assign';
import { missionCommand } from './commands';
import { missionFromArg, offsetFromArg, typeFromValue } from './data';
import { announceMissionHandler, refreshMissionCardHandler } from './jobs';
import { abandon, acceptMission, confirmAbandon, openSubmission, submitFromModal } from './member';
import { presentInPlace } from './present';
import { MISSIONS_NS } from './render';
import { openReviewModal, showReviewPage, submitReview } from './review';
import { backToDetail, changeSetting, openSettings } from './settings';
import {
  archive,
  close,
  confirmArchive,
  confirmPublish,
  createFromModal,
  editFromModal,
  openEdit,
  publish,
  reopen,
} from './staff';
import { detailPayload, MINE_SCOPES, minePayload, openListPayload } from './views';

async function expired(h: HandlerContext): Promise<void> {
  await h.respond({
    embeds: [failure('EXPIRED', 'This control is no longer active.')],
    ephemeral: true,
  });
}

/** A mission id chosen in a select (open, submit_pick). */
function pickedMission(h: HandlerContext): string {
  return missionFromArg(h.interaction.values[0]);
}

/** Member controls that act on one mission: `action:<missionId>`. */
async function memberAction(h: HandlerContext, action: string, missionId: string) {
  switch (action) {
    case 'accept':
      return acceptMission(h, missionId);
    case 'view':
      return h.respond(await detailPayload(h, missionId));
    case 'submit':
      return openSubmission(h, missionId);
    case 'abandon':
      return confirmAbandon(h, missionId);
    case 'abandon_confirm':
      return abandon(h, missionId);
    default:
      return null;
  }
}

/** Staff controls that act on one mission. Every service re-authorizes the clicking user. */
async function staffAction(h: HandlerContext, action: string, args: readonly string[]) {
  const missionId = missionFromArg(args[0]);
  switch (action) {
    case 'publish':
      return confirmPublish(h, missionId);
    case 'publish_go':
      return publish(h, missionId, args[1] === '1');
    case 'close':
      return close(h, missionId);
    case 'reopen':
      return reopen(h, missionId);
    case 'archive':
      return confirmArchive(h, missionId);
    case 'archive_go':
      return archive(h, missionId);
    case 'edit':
      return openEdit(h, missionId);
    case 'settings':
      return openSettings(h, missionId);
    case 'view_here':
      return backToDetail(h, missionId);
    case 'assign':
      return openAssign(h, missionId);
    case 'assign_opts':
      return openAssignOptions(h, missionId);
    case 'assign_pick':
      return assignPicked(h, missionId, args.slice(1));
    default:
      return (await changeSetting(h, action, missionId)) ? undefined : expired(h);
  }
}

/**
 * Buttons and selects. Custom ids route; they never authorize: every action
 * runs through core services as the clicking user.
 */
const components: ComponentHandler = {
  namespace: MISSIONS_NS,
  async handle(h, action, args) {
    switch (action) {
      case 'filter':
        return presentInPlace(
          h,
          await openListPayload(h, typeFromValue(h.interaction.values[0]), 0),
        );
      case 'list':
        return presentInPlace(
          h,
          await openListPayload(h, typeFromValue(args[0]), offsetFromArg(args[1])),
        );
      case 'mine': {
        const scope = MINE_SCOPES.find((candidate) => candidate === h.interaction.values[0]);
        return presentInPlace(h, await minePayload(h, scope ?? 'active'));
      }
      case 'open':
        return h.respond(await detailPayload(h, pickedMission(h)));
      case 'submit_pick':
        return openSubmission(h, pickedMission(h));
      case 'dismiss':
        return presentInPlace(h, {
          embeds: [panel({ title: 'NO CHANGE', description: 'Nothing was changed.' })],
          components: [],
        });
      case 'review':
        return showReviewPage(h, args[0]);
      case 'verify':
      case 'reject':
        return openReviewModal(h, action, args);
    }
    if (args.length === 0) return expired(h);
    const handled = await memberAction(h, action, missionFromArg(args[0]));
    if (handled === null) await staffAction(h, action, args);
  },
};

const modals: ModalHandler = {
  namespace: MISSIONS_NS,
  async handle(h, action, args) {
    switch (action) {
      case 'create':
        return createFromModal(h);
      case 'submit':
        return submitFromModal(h, missionFromArg(args[0]));
      case 'edit':
        return editFromModal(h, missionFromArg(args[0]));
      case 'assign_opts':
        return assignOptionsFromModal(h, missionFromArg(args[0]));
      case 'verify':
      case 'reject':
        return submitReview(h, action, args);
      default:
        return expired(h);
    }
  },
};

/** Discord surface for the missions domain. */
export const feature: BotFeature = {
  name: 'missions',
  commands: [missionCommand],
  components: [components],
  modals: [modals],
  jobHandlers: (services) => ({
    [missions.DISCORD_MISSION_ANNOUNCE_JOB]: announceMissionHandler(services),
    [missions.DISCORD_MISSION_REFRESH_CARD_JOB]: refreshMissionCardHandler(services),
  }),
};
