import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { achievements, can, isJaveError, ValidationError } from '@jave/core';
import type { AutocompleteChoice, HandlerContext, ModalPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { failure, panel, row, stringSelect, success } from '../../ui/components';
import { plainText, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
import { heldAwards, memberName, resolveMemberId } from './data';
import { ACHIEVEMENTS_NS, NAME_MAX, RARITY_LABEL, type HeldAward } from './render';

/** Form field ids inside the award/revoke modals. */
export const FIELD_ACHIEVEMENT = 'achievement';
export const FIELD_REASON = 'reason';
const SELECT_DESCRIPTION_MAX = 100;
const LABEL_DESCRIPTION_MAX = 100;

export function restricted(description: string) {
  return {
    embeds: [panel({ title: 'ACCESS RESTRICTED', description, color: COLORS.danger })],
    ephemeral: true,
  };
}

const AWARDER_ONLY = 'Only staff with canAwardAchievements can award, revoke or verify.';

function nameOf(title: string): string {
  return userText(title.toUpperCase(), achievements.TITLE_MAX);
}

// ── Autocomplete ────────────────────────────────────────────────────────────

/** Staff autocomplete over the catalog. Non-staff get nothing (no hidden titles leak). */
export async function achievementAutocomplete(h: HandlerContext): Promise<void> {
  const focused = h.interaction.options.focused();
  if (!focused || focused.name !== FIELD_ACHIEVEMENT || !can(h.ctx, 'canAwardAchievements')) {
    await h.interaction.autocomplete([]);
    return;
  }
  const includeInactive =
    h.interaction.options.subcommand() === 'revoke' && can(h.ctx, 'canManageAchievements');
  const catalog = await achievements.getAchievementCatalog(h.ctx, { includeInactive });
  const query = focused.value.trim().toLowerCase();
  const choices: AutocompleteChoice[] = [];
  for (const entry of catalog) {
    if (entry.masked) continue;
    if (query && !entry.title.toLowerCase().includes(query) && !entry.key.includes(query)) continue;
    const flags = [
      RARITY_LABEL[entry.rarity],
      entry.visibility === 'hidden' ? 'HIDDEN' : null,
      entry.active ? null : 'INACTIVE',
    ].filter(Boolean);
    choices.push({
      name: plainText(`${entry.title.toUpperCase()} ${GLYPH.dot} ${flags.join(` ${GLYPH.dot} `)}`, 100),
      value: entry.key,
    });
    if (choices.length >= LIMITS.autocompleteChoices) break;
  }
  await h.interaction.autocomplete(choices);
}

// ── Award / revoke ──────────────────────────────────────────────────────────

async function award(h: HandlerContext, memberId: string, key: string, reason: string) {
  const record = await achievements.awardAchievement(h.ctx, { memberId, key, reason });
  const [definition, name] = await Promise.all([
    achievements.getAchievementCatalog(h.ctx).then((catalog) =>
      catalog.find((entry) => !entry.masked && entry.key === key),
    ),
    memberName(h, memberId),
  ]);
  const title = definition && !definition.masked ? definition.title : key;
  const pending =
    record.verification === 'verified'
      ? 'Recorded, notified and announced where enabled.'
      : 'Pending verification by a second staff member.';
  await h.respond({
    embeds: [
      success(
        'Achievement awarded',
        `${nameOf(title)} — ${userText(name, NAME_MAX)}.\n${pending}`,
      ),
    ],
    ephemeral: true,
  });
}

async function revoke(h: HandlerContext, memberId: string, key: string, reason: string) {
  const held = await heldAwards(h, memberId);
  const title = held.find((entry) => entry.key === key)?.title ?? key;
  await achievements.revokeAchievement(h.ctx, { memberId, key, reason });
  await h.respond({
    embeds: [
      success(
        'Achievement revoked',
        `${nameOf(title)} — ${userText(await memberName(h, memberId), NAME_MAX)}.\nThe member is notified and any public card is removed.`,
      ),
    ],
    ephemeral: true,
  });
}

function commandTarget(h: HandlerContext) {
  const target = h.interaction.options.user('member');
  const key = h.interaction.options.string(FIELD_ACHIEVEMENT);
  const reason = h.interaction.options.string(FIELD_REASON);
  if (!target || !key || !reason) throw new ValidationError('Choose a member, an achievement and a reason.');
  return { target, key: key.trim(), reason };
}

export async function awardFromCommand(h: HandlerContext): Promise<void> {
  const { target, key, reason } = commandTarget(h);
  const memberId = await resolveMemberId(h, { discordId: target.id });
  await award(h, memberId, key, reason);
}

export async function revokeFromCommand(h: HandlerContext): Promise<void> {
  const { target, key, reason } = commandTarget(h);
  const memberId = await resolveMemberId(h, { discordId: target.id });
  await revoke(h, memberId, key, reason);
}

// ── Modals (from the member view's buttons) ─────────────────────────────────

interface ModalOption {
  key: string;
  title: string;
  summary: string;
  rarity: HeldAward['rarity'];
}

function reasonInput(): TextInputBuilder {
  return new TextInputBuilder()
    .setCustomId(FIELD_REASON)
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(achievements.REASON_MIN)
    .setMaxLength(achievements.REASON_MAX)
    .setRequired(true);
}

export function achievementModal(
  action: 'award' | 'revoke',
  memberId: string,
  memberDisplayName: string,
  options: readonly ModalOption[],
): ModalPayload {
  const shown = options.slice(0, LIMITS.selectOptions);
  const overflow =
    options.length > shown.length
      ? `Showing ${shown.length} of ${options.length}. Use /achievements ${action} for the rest.`
      : action === 'award'
        ? 'Achievements this member does not hold.'
        : 'Achievements this member holds.';
  return new ModalBuilder()
    .setCustomId(customId(ACHIEVEMENTS_NS, action, memberId))
    .setTitle(
      plainText(`${action === 'award' ? 'AWARD' : 'REVOKE'} — ${memberDisplayName.toUpperCase()}`, LIMITS.modalTitle),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Achievement')
        .setDescription(plainText(overflow, LABEL_DESCRIPTION_MAX))
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId(FIELD_ACHIEVEMENT)
            .setRequired(true)
            .addOptions(
              shown.map((option) => ({
                label: plainText(option.title.toUpperCase(), 100),
                description: plainText(
                  `${RARITY_LABEL[option.rarity]} ${GLYPH.dot} ${option.summary}`,
                  SELECT_DESCRIPTION_MAX,
                ),
                value: option.key,
              })),
            ),
        ),
      new LabelBuilder()
        .setLabel('Reason')
        .setDescription(
          action === 'award'
            ? 'Recorded in the audit log with the award.'
            : 'Recorded in the audit log. The member is told it was revoked.',
        )
        .setTextInputComponent(reasonInput()),
    )
    .toJSON();
}

function requireAwarder(h: HandlerContext): boolean {
  return can(h.ctx, 'canAwardAchievements');
}

/** AWARD button: pick one of the active achievements the member does not hold. */
export async function openAwardModal(h: HandlerContext, memberId: string): Promise<void> {
  if (!requireAwarder(h)) return h.respond(restricted(AWARDER_ONLY));
  const held = await heldAwards(h, memberId);
  const heldKeys = new Set(held.map((entry) => entry.key));
  const [catalog, name] = await Promise.all([
    achievements.getAchievementCatalog(h.ctx),
    memberName(h, memberId),
  ]);
  const options: ModalOption[] = [];
  for (const entry of catalog) {
    if (entry.masked || heldKeys.has(entry.key)) continue;
    options.push({ key: entry.key, title: entry.title, summary: entry.summary, rarity: entry.rarity });
  }
  if (options.length === 0) {
    return h.respond({
      embeds: [panel({ title: 'NOTHING TO AWARD', description: 'This member holds every active achievement.' })],
      ephemeral: true,
    });
  }
  await h.interaction.showModal(achievementModal('award', memberId, name, options));
}

/** REVOKE button: pick one of the member's awards. */
export async function openRevokeModal(h: HandlerContext, memberId: string): Promise<void> {
  if (!requireAwarder(h)) return h.respond(restricted(AWARDER_ONLY));
  const [held, name] = await Promise.all([heldAwards(h, memberId), memberName(h, memberId)]);
  if (held.length === 0) {
    return h.respond({
      embeds: [panel({ title: 'NOTHING TO REVOKE', description: 'This member holds no achievements.' })],
      ephemeral: true,
    });
  }
  await h.interaction.showModal(achievementModal('revoke', memberId, name, held));
}

export async function submitAchievementModal(
  h: HandlerContext,
  action: 'award' | 'revoke',
  memberId: string,
): Promise<void> {
  const key = h.interaction.modal.select(FIELD_ACHIEVEMENT)[0];
  const reason = h.interaction.modal.text(FIELD_REASON);
  if (!key) throw new ValidationError('Choose an achievement.');
  if (action === 'award') await award(h, memberId, key, reason);
  else await revoke(h, memberId, key, reason);
}

// ── Verify ──────────────────────────────────────────────────────────────────

/** VERIFY button: list the member's UNVERIFIED awards in a select. */
export async function openVerifySelect(h: HandlerContext, memberId: string): Promise<void> {
  if (!requireAwarder(h)) return h.respond(restricted(AWARDER_ONLY));
  const [held, name] = await Promise.all([heldAwards(h, memberId), memberName(h, memberId)]);
  const pending = held.filter((entry) => !entry.verified).slice(0, LIMITS.selectOptions);
  if (pending.length === 0) {
    return h.respond({
      embeds: [panel({ title: 'NOTHING TO VERIFY', description: 'Every award of this member is verified.' })],
      ephemeral: true,
    });
  }
  await h.respond({
    embeds: [
      panel({
        kicker: 'ACHIEVEMENT VERIFICATION',
        title: userText(name, NAME_MAX),
        description:
          'Verify awards made by someone else. You cannot verify your own awards or awards you made.',
      }),
    ],
    components: [
      row(
        stringSelect(
          customId(ACHIEVEMENTS_NS, 'verify_pick', memberId),
          'Choose awards to verify',
          pending.map((entry) => ({
            label: plainText(entry.title.toUpperCase(), 100),
            description: plainText(
              `${RARITY_LABEL[entry.rarity]} ${GLYPH.dot} ${entry.summary}`,
              SELECT_DESCRIPTION_MAX,
            ),
            value: entry.key,
          })),
          { min: 1, max: pending.length },
        ),
      ),
    ],
    ephemeral: true,
  });
}

/** Verify each chosen award; one refusal does not stop the others. */
export async function verifyChosen(
  h: HandlerContext,
  memberId: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) throw new ValidationError('Choose at least one award.');
  const unique = [...new Set(keys)].slice(0, LIMITS.selectOptions);
  const held = await heldAwards(h, memberId);
  const titles = new Map(held.map((entry) => [entry.key, entry.title]));
  const lines: string[] = [];
  let verified = 0;
  for (const key of unique) {
    const title = nameOf(titles.get(key) ?? key);
    try {
      await achievements.verifyMemberAchievement(h.ctx, { memberId, key });
      verified++;
      lines.push(`${GLYPH.verified} ${title}`);
    } catch (error) {
      if (!isJaveError(error)) throw error;
      lines.push(`${GLYPH.cross} ${title} — ${userText(error.userMessage, 200)}`);
    }
  }
  const name = userText(await memberName(h, memberId), NAME_MAX);
  const embed =
    verified > 0
      ? success(`${verified} award${verified === 1 ? '' : 's'} verified`, `${name}\n${lines.join('\n')}`)
      : failure('Nothing verified', `${name}\n${lines.join('\n')}`);
  await h.interaction.update({ embeds: [embed], components: [] });
}
