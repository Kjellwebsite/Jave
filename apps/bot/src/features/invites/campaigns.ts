import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import type { APIEmbedField, APISelectMenuOption } from 'discord.js';
import {
  authorize,
  can,
  DAY,
  invites,
  isUuid,
  NotFoundError,
  type Page,
  ValidationError,
} from '@jave/core';
import type { HandlerContext, ModalPayload, ReplyPayload } from '../../interactions/types';
import { customId } from '../../interactions/custom-id';
import { button, field, panel, row, stringSelect } from '../../ui/components';
import { discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
import { deliver, type Delivery } from './member-flows';
import { funnelBlock, INVITES_NS } from './views';

/** Campaigns summarized in the list card (the select offers up to 25). */
const CAMPAIGNS_IN_LIST = 10;
/** Invites per picker page and per attached-invites page (Discord's select-menu cap). */
export const INVITE_PAGE_SIZE = LIMITS.selectOptions;
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DAY_LENGTH = 10;
const CAMPAIGN_KEY_MAX = 48;
const CAMPAIGN_NAME_MAX = 120;
const CAMPAIGN_DESCRIPTION_MAX = 2000;
const SELECT_DESCRIPTION_MAX = 100;
/** Invites read per page when checking that one is attached to a campaign (core's page cap). */
const ATTACHED_SCAN_PAGE = 100;
/** Discord caps a guild at 1000 invites (plus the vanity URL): 11 pages always suffice. */
const ATTACHED_SCAN_MAX_PAGES = 11;

type CampaignView = invites.CampaignView;

/** Campaign ids arrive in custom ids: route hints only, validated before use. */
export function parseCampaignId(value: string | undefined): string {
  if (!value || !isUuid(value)) throw new ValidationError('This control is malformed.');
  return value;
}

/** A page offset from a custom id (absent means the first page). */
export function parsePageOffset(value: string | undefined): number {
  const offset = Number(value ?? 0);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ValidationError('This control is malformed.');
  }
  return offset;
}

/** "`code` · 3 uses", marked when Discord no longer lists the invite. */
function attachedLine(invite: invites.InviteCodeView): string {
  const deleted = invite.deletedAt ? ` ${GLYPH.dot} deleted on Discord` : '';
  return `\`${invite.code}\` ${GLYPH.dot} ${invite.uses} uses${deleted}`;
}

function campaignState(campaign: CampaignView, now: Date): string {
  if (!campaign.active) return 'INACTIVE';
  if (campaign.acceptingNow) return 'ACCEPTING';
  if (campaign.startsAt && campaign.startsAt.getTime() > now.getTime()) return 'SCHEDULED';
  return 'ENDED';
}

function funnelLine(funnel: invites.ReferralFunnel): string {
  return [
    `INVITED ${funnel.invited}`,
    `JOINED ${funnel.joined}`,
    `RETAINED ${funnel.retained}`,
    `VALID ${funnel.valid}`,
  ].join(` ${GLYPH.dot} `);
}

function windowText(campaign: CampaignView): string {
  const start = campaign.startsAt ? discordTime(campaign.startsAt, 'f') : 'open';
  const end = campaign.endsAt ? discordTime(campaign.endsAt, 'f') : 'open';
  return `${start} ${GLYPH.arrow} ${end}`;
}

/** Staff: every campaign with its funnel, a picker to open one, and "new" for managers. */
export async function showCampaignList(h: HandlerContext, mode: Delivery): Promise<void> {
  const campaigns = await invites.listCampaigns(h.ctx, { includeInactive: true });
  const now = h.ctx.clock.now();
  const manage = can(h.ctx, 'canManageCampaigns');
  const lines = campaigns
    .slice(0, CAMPAIGNS_IN_LIST)
    .map(
      (campaign) =>
        `**${userText(campaign.name, 120)}** \`${campaign.key}\` ${GLYPH.dot} ${campaignState(campaign, now)}\n${funnelLine(campaign.funnel)}`,
    );
  if (campaigns.length > CAMPAIGNS_IN_LIST) {
    lines.push(`${campaigns.length - CAMPAIGNS_IN_LIST} more — pick one below or open /referrals.`);
  }
  const components: NonNullable<ReplyPayload['components']> = [];
  if (campaigns.length > 0) {
    components.push(
      row(
        stringSelect(
          customId(INVITES_NS, 'camp-view'),
          'Open a campaign',
          campaigns.slice(0, LIMITS.selectOptions).map((campaign) => ({
            label: campaign.name.slice(0, SELECT_DESCRIPTION_MAX),
            value: campaign.id,
            description: `${campaign.key} · ${campaignState(campaign, now)}`,
          })),
        ),
      ),
    );
  }
  if (manage) {
    components.push(row(button('New campaign', customId(INVITES_NS, 'camp-new'), 'primary')));
  }
  await deliver(
    h,
    {
      embeds: [
        panel({
          kicker: 'REFERRALS · STAFF',
          title: 'Campaigns',
          description:
            lines.length > 0
              ? lines.join('\n\n')
              : 'No campaigns yet. A campaign credits joins through its invites and codes while it is active and inside its window.',
        }),
      ],
      components,
      ephemeral: true,
    },
    mode,
  );
}

function attachedFieldName(page: Page<invites.InviteCodeView>): string {
  if (page.total <= INVITE_PAGE_SIZE) return 'Attached invites';
  const last = page.offset + page.items.length;
  return `Attached invites ${GLYPH.dot} ${page.offset + 1}–${last} of ${page.total}`;
}

function attachedPager(campaignId: string, page: Page<invites.InviteCodeView>) {
  const nav = [];
  if (page.offset > 0) {
    const previous = Math.max(0, page.offset - INVITE_PAGE_SIZE);
    nav.push(button('Previous', customId(INVITES_NS, 'camp-view-id', campaignId, previous)));
  }
  if (page.offset + page.items.length < page.total) {
    const next = page.offset + INVITE_PAGE_SIZE;
    nav.push(button('Next', customId(INVITES_NS, 'camp-view-id', campaignId, next)));
  }
  return nav;
}

function detailPayload(
  campaign: CampaignView,
  attached: Page<invites.InviteCodeView>,
  options: { manage: boolean; now: Date; notice?: string },
): ReplyPayload {
  const fields: APIEmbedField[] = [
    field('State', campaignState(campaign, options.now), true),
    field('Window', windowText(campaign), true),
    field('Funnel', funnelBlock(campaign.funnel)),
    field(
      attachedFieldName(attached),
      attached.items.length > 0
        ? attached.items.map(attachedLine).join('\n')
        : 'None. Joins through attached invites credit this campaign while it accepts.',
    ),
  ];
  if (campaign.description) fields.push(field('Description', userText(campaign.description)));
  const embeds = [
    panel({
      kicker: `CAMPAIGN ${GLYPH.dot} ${campaign.key}`,
      title: userText(campaign.name, 200),
      fields,
    }),
  ];
  if (options.notice) {
    embeds.unshift(panel({ title: `${GLYPH.verified} ${options.notice}`, color: COLORS.success }));
  }
  const components: NonNullable<ReplyPayload['components']> = [];
  if (options.manage && attached.items.length > 0) {
    components.push(
      row(
        stringSelect(
          customId(INVITES_NS, 'inv-detach', campaign.id, attached.offset),
          'Detach an invite',
          attached.items.map((invite) => ({
            label: invite.code,
            value: invite.code,
            description: invite.deletedAt
              ? `${invite.uses} uses · deleted on Discord`
              : `${invite.uses} uses`,
          })),
        ),
      ),
    );
  }
  const pager = attachedPager(campaign.id, attached);
  if (pager.length > 0) components.push(row(...pager));
  if (options.manage) {
    components.push(
      row(
        button('Attach invite', customId(INVITES_NS, 'inv-page', campaign.id, 0), 'primary'),
        campaign.active
          ? button('Deactivate', customId(INVITES_NS, 'camp-active', campaign.id, 0), 'danger')
          : button('Activate', customId(INVITES_NS, 'camp-active', campaign.id, 1)),
        button('All campaigns', customId(INVITES_NS, 'camp-list')),
      ),
    );
  } else {
    components.push(row(button('All campaigns', customId(INVITES_NS, 'camp-list'))));
  }
  return { embeds, components, ephemeral: true };
}

/** One page of the invites attached to a campaign, deleted ones included (live first). */
async function attachedPage(h: HandlerContext, campaignId: string, offset: number) {
  const load = (at: number) =>
    invites.listInviteCodes(h.ctx, {
      campaignId,
      includeDeleted: true,
      limit: INVITE_PAGE_SIZE,
      offset: at,
    });
  const page = await load(offset);
  if (page.items.length > 0 || page.total === 0) return page;
  // A stale card (its last invite on this page was detached): show the last page instead.
  return load(Math.floor((page.total - 1) / INVITE_PAGE_SIZE) * INVITE_PAGE_SIZE);
}

export async function showCampaign(
  h: HandlerContext,
  campaignId: string,
  mode: Delivery,
  options: { notice?: string; offset?: number } = {},
): Promise<void> {
  const campaign = await invites.getCampaign(h.ctx, campaignId);
  const attached = await attachedPage(h, campaign.id, options.offset ?? 0);
  await deliver(
    h,
    detailPayload(campaign, attached, {
      manage: can(h.ctx, 'canManageCampaigns'),
      now: h.ctx.clock.now(),
      notice: options.notice,
    }),
    mode,
  );
}

/** Activate / deactivate. The target state rides in the custom id, so repeats are idempotent. */
export async function setCampaignActive(
  h: HandlerContext,
  campaignId: string,
  flag: string | undefined,
): Promise<void> {
  if (flag !== '0' && flag !== '1') throw new ValidationError('This control is malformed.');
  const active = flag === '1';
  await invites.updateCampaign(h.ctx, { campaignId, active });
  await showCampaign(h, campaignId, 'update', {
    notice: active ? 'CAMPAIGN ACTIVATED' : 'CAMPAIGN DEACTIVATED',
  });
}

function inviteOption(invite: invites.InviteCodeView, campaignId: string): APISelectMenuOption {
  const parts = [
    invite.vanity ? 'vanity URL' : (invite.inviterName ?? 'unknown inviter'),
    `${invite.uses} uses`,
  ];
  if (invite.campaignId === campaignId) parts.push('attached');
  else if (invite.campaignId) parts.push('in another campaign');
  return {
    label: invite.code,
    value: invite.code,
    description: parts.join(' · ').slice(0, SELECT_DESCRIPTION_MAX),
  };
}

/** Staff: pick a live invite to attach to a campaign, one select page at a time. */
export async function showInvitePicker(
  h: HandlerContext,
  campaignId: string,
  offsetArg: string | undefined,
  mode: Delivery,
): Promise<void> {
  await authorize(h.ctx, 'canManageCampaigns', { type: 'campaign', id: campaignId });
  const offset = parsePageOffset(offsetArg);
  const campaign = await invites.getCampaign(h.ctx, campaignId);
  const page = await invites.listInviteCodes(h.ctx, { limit: INVITE_PAGE_SIZE, offset });
  const components: NonNullable<ReplyPayload['components']> = [];
  if (page.items.length > 0) {
    components.push(
      row(
        stringSelect(
          customId(INVITES_NS, 'inv-pick', campaign.id),
          'Invite to attach',
          page.items.map((invite) => inviteOption(invite, campaign.id)),
        ),
      ),
    );
  }
  const nav = [];
  if (offset > 0) {
    nav.push(
      button(
        'Previous',
        customId(INVITES_NS, 'inv-page', campaign.id, Math.max(0, offset - INVITE_PAGE_SIZE)),
      ),
    );
  }
  if (offset + page.items.length < page.total) {
    nav.push(
      button('Next', customId(INVITES_NS, 'inv-page', campaign.id, offset + INVITE_PAGE_SIZE)),
    );
  }
  nav.push(button('Back', customId(INVITES_NS, 'camp-view-id', campaign.id)));
  components.push(row(...nav));
  const shownTo = offset + page.items.length;
  await deliver(
    h,
    {
      embeds: [
        panel({
          kicker: `CAMPAIGN ${GLYPH.dot} ${campaign.key}`,
          title: 'Attach an invite',
          description:
            page.total > 0
              ? `Live invites ${offset + 1}–${shownTo} of ${page.total}, most used first. Only future joins through the invite credit the campaign; history is not rewritten.`
              : 'No live invites are mirrored. Create an invite in Discord; JAVE picks it up within seconds.',
        }),
      ],
      components,
      ephemeral: true,
    },
    mode,
  );
}

export async function attachInvite(h: HandlerContext, campaignId: string): Promise<void> {
  const [code] = h.interaction.values;
  const invite = await invites.attachInviteToCampaign(h.ctx, { code: code ?? '', campaignId });
  await showCampaign(h, campaignId, 'update', { notice: `INVITE ATTACHED — ${invite.code}` });
}

/** Whether `code` is attached to `campaignId` now, deleted or not (the card may be stale). */
async function isAttached(h: HandlerContext, campaignId: string, code: string): Promise<boolean> {
  for (let page = 0; page < ATTACHED_SCAN_MAX_PAGES; page++) {
    const result = await invites.listInviteCodes(h.ctx, {
      campaignId,
      includeDeleted: true,
      limit: ATTACHED_SCAN_PAGE,
      offset: page * ATTACHED_SCAN_PAGE,
    });
    if (result.items.some((invite) => invite.code === code)) return true;
    if ((page + 1) * ATTACHED_SCAN_PAGE >= result.total) return false;
  }
  return false;
}

/** Detach an invite from this campaign (only one that is attached to it), then reshow that page. */
export async function detachInvite(
  h: HandlerContext,
  campaignId: string,
  offsetArg: string | undefined,
): Promise<void> {
  const [code] = h.interaction.values;
  const offset = parsePageOffset(offsetArg);
  await authorize(h.ctx, 'canManageCampaigns', { type: 'campaign', id: campaignId });
  if (!code || !(await isAttached(h, campaignId, code))) throw new NotFoundError('Invite');
  const invite = await invites.attachInviteToCampaign(h.ctx, { code, campaignId: null });
  await showCampaign(h, campaignId, 'update', {
    notice: `INVITE DETACHED — ${invite.code}`,
    offset,
  });
}

/** Staff: choose which campaign to attach an invite to. */
export async function showAttachStart(h: HandlerContext): Promise<void> {
  await authorize(h.ctx, 'canManageCampaigns', { type: 'campaign' });
  const campaigns = await invites.listCampaigns(h.ctx, { includeInactive: false });
  if (campaigns.length === 0) {
    await h.respond({
      embeds: [
        panel({
          title: 'No active campaigns',
          description: 'Create one with `/invites campaign create` first.',
        }),
      ],
      ephemeral: true,
    });
    return;
  }
  await h.respond({
    embeds: [
      panel({
        kicker: 'REFERRALS · STAFF',
        title: 'Attach an invite',
        description: 'Choose the campaign the invite should credit.',
      }),
    ],
    components: [
      row(
        stringSelect(
          customId(INVITES_NS, 'camp-attach'),
          'Campaign',
          campaigns.slice(0, LIMITS.selectOptions).map((campaign) => ({
            label: campaign.name.slice(0, SELECT_DESCRIPTION_MAX),
            value: campaign.id,
            description: campaign.key,
          })),
        ),
      ),
    ],
    ephemeral: true,
  });
}

// ─── Create ──────────────────────────────────────────────────────────────────

export function campaignModal(): ModalPayload {
  const text = (id: string, style: TextInputStyle, max: number, required: boolean) =>
    new TextInputBuilder().setCustomId(id).setStyle(style).setMaxLength(max).setRequired(required);
  return new ModalBuilder()
    .setCustomId(customId(INVITES_NS, 'camp-create'))
    .setTitle('NEW CAMPAIGN')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Key')
        .setDescription('2–48 lowercase letters, digits or dashes. Permanent.')
        .setTextInputComponent(text('key', TextInputStyle.Short, CAMPAIGN_KEY_MAX, true)),
      new LabelBuilder()
        .setLabel('Name')
        .setTextInputComponent(text('name', TextInputStyle.Short, CAMPAIGN_NAME_MAX, true)),
      new LabelBuilder()
        .setLabel('Description')
        .setTextInputComponent(
          text('description', TextInputStyle.Paragraph, CAMPAIGN_DESCRIPTION_MAX, false),
        ),
      new LabelBuilder()
        .setLabel('Starts (UTC)')
        .setDescription('YYYY-MM-DD. Empty: immediately.')
        .setTextInputComponent(text('starts', TextInputStyle.Short, ISO_DAY_LENGTH, false)),
      new LabelBuilder()
        .setLabel('Ends (UTC, inclusive)')
        .setDescription('YYYY-MM-DD. Empty: open-ended.')
        .setTextInputComponent(text('ends', TextInputStyle.Short, ISO_DAY_LENGTH, false)),
    )
    .toJSON();
}

/** 'YYYY-MM-DD' → midnight UTC (or the following midnight for an inclusive end day). */
export function parseCampaignDay(raw: string, field: 'starts' | 'ends'): Date | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const start = new Date(`${value}T00:00:00.000Z`);
  if (
    !ISO_DAY_PATTERN.test(value) ||
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, ISO_DAY_LENGTH) !== value
  ) {
    throw new ValidationError('Dates use YYYY-MM-DD.', [
      { path: field, message: 'Use YYYY-MM-DD.' },
    ]);
  }
  return field === 'ends' ? new Date(start.getTime() + DAY) : start;
}

export async function openCampaignModal(h: HandlerContext): Promise<void> {
  await authorize(h.ctx, 'canManageCampaigns', { type: 'campaign' });
  await h.interaction.showModal(campaignModal());
}

export async function createCampaignFromModal(h: HandlerContext): Promise<void> {
  const { modal } = h.interaction;
  const campaign = await invites.createCampaign(h.ctx, {
    key: modal.text('key'),
    name: modal.text('name'),
    description: modal.text('description') || undefined,
    startsAt: parseCampaignDay(modal.text('starts'), 'starts'),
    endsAt: parseCampaignDay(modal.text('ends'), 'ends'),
  });
  await showCampaign(h, campaign.id, 'reply', { notice: `CAMPAIGN CREATED — ${campaign.key}` });
}
