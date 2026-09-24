import { SlashCommandBuilder } from 'discord.js';
import {
  can,
  claimRank,
  findMemberByDiscordId,
  getProfile,
  getRankHistory,
  loadCatalog,
  NotFoundError,
  requireMember,
  setVerifiedRank,
  ValidationError,
} from '@jave/core';
import type { CommandDefinition, HandlerContext } from '../../interactions/types';
import { field, panel, success } from '../../ui/components';
import { discordTime, rankMark, userText } from '../../ui/format';
import { renderCapabilities } from '../../ui/profile';
import { COLORS, GLYPH } from '../../ui/theme';

const HISTORY_LIMIT = 15;

async function facetChoices(h: HandlerContext, query: string) {
  const catalog = await loadCatalog(h.ctx);
  const q = query.toLowerCase();
  return catalog.facets
    .map((f) => {
      const domain = catalog.domains.find((d) => d.key === f.domainKey)?.label ?? f.domainKey;
      return { name: `${domain.toUpperCase()} ${GLYPH.bar} ${f.label}`, value: f.key };
    })
    .filter((c) => c.name.toLowerCase().includes(q) || c.value.includes(q))
    .slice(0, 25);
}

async function rankChoices(h: HandlerContext, query: string, allowClear: boolean) {
  const catalog = await loadCatalog(h.ctx);
  const choices = [...catalog.tiers]
    .reverse()
    .map((t) => ({ name: `${t.code} — ${t.description}`.slice(0, 100), value: t.code }));
  if (allowClear) choices.push({ name: 'CLEAR — withdraw / remove', value: 'none' });
  const q = query.toUpperCase();
  return choices.filter(
    (c) => !q || c.value.toUpperCase().startsWith(q) || c.name.toUpperCase().includes(q),
  );
}

async function resolveMemberId(h: HandlerContext, discordId: string): Promise<string> {
  const member = await findMemberByDiscordId(h.ctx, discordId);
  if (!member) throw new NotFoundError('JVLN profile');
  return member.id;
}

function parseRank(value: string | null): string | null {
  if (!value || value === 'none') return null;
  return value.toUpperCase();
}

export const rankCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Capabilities and ranks.')
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Capability breakdown (verified, claimed, unknown).')
        .addUserOption((o) => o.setName('member').setDescription('Member (default: you)')),
    )
    .addSubcommand((s) =>
      s
        .setName('claim')
        .setDescription('Claim a rank. Claims stay CLAIMED until verified.')
        .addStringOption((o) =>
          o
            .setName('capability')
            .setDescription('Capability')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('rank')
            .setDescription('Rank (or CLEAR)')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('evidence_url')
            .setDescription('Link to evidence (optional)')
            .setMaxLength(2048),
        )
        .addStringOption((o) =>
          o.setName('evidence_title').setDescription('What the evidence shows').setMaxLength(200),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('Rank history.')
        .addUserOption((o) =>
          o.setName('member').setDescription('Member (staff only; default: you)'),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('verify')
        .setDescription('Evaluator: set a verified rank.')
        .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('capability')
            .setDescription('Capability')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('rank')
            .setDescription('Rank (or CLEAR)')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((o) =>
          o
            .setName('reason')
            .setDescription('Why (recorded in history)')
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(1000),
        ),
    )
    .toJSON(),
  help: {
    category: 'identity',
    summary: 'View, claim and verify capability ranks.',
    usage: '/rank view | claim | history | verify',
  },
  defer: 'ephemeral',

  async autocomplete(h) {
    const focused = h.interaction.options.focused();
    if (!focused) return h.interaction.autocomplete([]);
    if (focused.name === 'capability')
      return h.interaction.autocomplete(await facetChoices(h, focused.value));
    if (focused.name === 'rank')
      return h.interaction.autocomplete(await rankChoices(h, focused.value, true));
    return h.interaction.autocomplete([]);
  },

  async execute(h) {
    const o = h.interaction.options;
    switch (o.subcommand()) {
      case 'view': {
        const target = o.user('member') ?? h.interaction.user;
        const view = await getProfile(h.ctx, { discordId: target.id });
        return h.respond(renderCapabilities(view));
      }
      case 'claim': {
        const facetKey = o.string('capability') ?? '';
        const rank = parseRank(o.string('rank'));
        const evidenceUrl = o.string('evidence_url');
        const evidenceTitle = o.string('evidence_title');
        if (evidenceTitle && !evidenceUrl)
          throw new ValidationError('Add an evidence URL with the title.');
        await claimRank(h.ctx, {
          facetKey,
          rank,
          evidence: evidenceUrl
            ? { title: evidenceTitle ?? 'Evidence', url: evidenceUrl }
            : undefined,
        });
        const catalog = await loadCatalog(h.ctx);
        const label = catalog.facets.find((f) => f.key === facetKey)?.label ?? facetKey;
        return h.respond({
          embeds: [
            success(
              rank ? 'Claim recorded' : 'Claim withdrawn',
              rank
                ? `${label.toUpperCase()} ${GLYPH.dot} ${rankMark(rank, 'claimed')} CLAIMED\nClaims become VERIFIED only through evidence, trials or an evaluator.`
                : `${label.toUpperCase()} ${GLYPH.dot} claim removed.`,
            ),
          ],
          ephemeral: true,
        });
      }
      case 'history': {
        const target = o.user('member');
        const memberId = target
          ? await resolveMemberId(h, target.id)
          : requireMember(h.ctx).memberId;
        const [history, catalog] = await Promise.all([
          getRankHistory(h.ctx, memberId),
          loadCatalog(h.ctx),
        ]);
        const label = (key: string) => catalog.facets.find((f) => f.key === key)?.label ?? key;
        const lines = history.slice(0, HISTORY_LIMIT).map((entry) => {
          const from = entry.fromRank ?? GLYPH.unknown;
          const to = entry.toRank ?? GLYPH.unknown;
          const track = entry.track === 'verified' ? 'VERIFIED' : 'CLAIMED';
          const who = entry.actorName ? ` ${GLYPH.dot} ${userText(entry.actorName, 40)}` : '';
          return `${discordTime(entry.createdAt, 'd')} ${GLYPH.bar} **${label(entry.facetKey).toUpperCase()}** ${from} ${GLYPH.arrow} ${to} ${GLYPH.dot} ${track}${who}`;
        });
        return h.respond({
          embeds: [
            panel({
              kicker: 'JVLN RANK HISTORY',
              title: target ? (target.globalName ?? target.username) : 'Your history',
              description: lines.length ? lines.join('\n') : 'No rank changes recorded yet.',
              footer:
                history.length > HISTORY_LIMIT
                  ? `Showing ${HISTORY_LIMIT} of ${history.length}. Full history in the dashboard.`
                  : undefined,
            }),
          ],
          ephemeral: true,
        });
      }
      case 'verify': {
        if (!can(h.ctx, 'canModifyRanks')) {
          return h.respond({
            embeds: [
              panel({
                title: 'ACCESS RESTRICTED',
                description: 'Only evaluators can set verified ranks.',
                color: COLORS.danger,
              }),
            ],
            ephemeral: true,
          });
        }
        const target = o.user('member');
        if (!target) throw new ValidationError('Choose a member.');
        const memberId = await resolveMemberId(h, target.id);
        const facetKey = o.string('capability') ?? '';
        const rank = parseRank(o.string('rank'));
        const result = await setVerifiedRank(h.ctx, {
          memberId,
          facetKey,
          rank,
          reason: o.string('reason') ?? '',
        });
        const catalog = await loadCatalog(h.ctx);
        const label = catalog.facets.find((f) => f.key === facetKey)?.label ?? facetKey;
        const embed = success(
          result.changed ? 'Verified rank set' : 'No change',
          `${userText(target.globalName ?? target.username)} ${GLYPH.dot} ${label.toUpperCase()} ${GLYPH.dot} ${rankMark(rank, rank ? 'verified' : 'unknown')}`,
        );
        embed.fields = [field('Recorded', 'Rank history, audit log and member notification.')];
        return h.respond({ embeds: [embed], ephemeral: true });
      }
      default:
        throw new ValidationError('Unknown subcommand.');
    }
  },
};
