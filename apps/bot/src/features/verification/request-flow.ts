import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { loadCatalog, ValidationError, verification } from '@jave/core';
import type {
  AutocompleteChoice,
  HandlerContext,
  ModalPayload,
  ReplyPayload,
} from '../../interactions/types';
import { button, panel, row, stringSelect, success } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH, LIMITS } from '../../ui/theme';
import {
  ACTIONS,
  parseTargetRef,
  parseType,
  type TargetRef,
  targetArgs,
  toRequestTarget,
  VERIFICATION_TYPES,
  type VerificationType,
  verificationId,
} from './ids';
import { NO_TARGET_COPY, TYPE_DESCRIPTIONS } from './labels';

/** Modal fields. Three links keep the form short; the dashboard takes more. */
export const REQUEST_FIELDS = {
  claim: 'claim',
  evidence: ['evidence1', 'evidence2', 'evidence3'],
} as const;

const KICKER = 'VERIFICATION REQUEST';
const OPTION_TEXT_CHARS = 100;
const EVIDENCE_TITLE_CHARS = 200;
const FALLBACK_EVIDENCE_TITLE = 'Evidence link';
/** Core caps candidate searches at this length. */
const AUTOCOMPLETE_QUERY_CHARS = 64;

type TargetCandidate = verification.TargetCandidate;
type CandidateType = verification.TargetCandidateType;

function isCandidateType(type: VerificationType): type is CandidateType {
  return (verification.TARGET_CANDIDATE_TYPES as readonly string[]).includes(type);
}

function candidateOption(candidate: TargetCandidate) {
  return {
    label: clip(candidate.label, OPTION_TEXT_CHARS),
    value: candidate.targetId,
    description: clip(candidate.detail, OPTION_TEXT_CHARS),
  };
}

/** Step 1: what to verify. */
export function typePanel(): ReplyPayload {
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: 'WHAT SHOULD BE VERIFIED?',
        description:
          'Verification moves something from CLAIMED to VERIFIED. Pick a type; JAVE lists what you can put forward. A verifier who is not you decides.',
        color: COLORS.chrome,
      }),
    ],
    components: [
      row(
        stringSelect(
          verificationId(ACTIONS.type),
          'Choose a type',
          VERIFICATION_TYPES.map((type) => ({
            label: verification.TYPE_LABELS[type],
            value: type,
            description: TYPE_DESCRIPTIONS[type],
          })),
        ),
      ),
    ],
    ephemeral: true,
  };
}

/** Step 2: which of the member's own targets (a select, no typing). */
async function targetPanel(h: HandlerContext, type: CandidateType): Promise<ReplyPayload> {
  const candidates = await verification.listTargetCandidates(h.ctx, { type });
  const label = verification.TYPE_LABELS[type];
  if (candidates.length === 0) {
    return {
      embeds: [
        panel({
          kicker: KICKER,
          title: `NOTHING TO VERIFY — ${label}`,
          description: NO_TARGET_COPY[type],
          color: COLORS.steel,
        }),
      ],
      components: [row(button('Choose another type', verificationId(ACTIONS.start)))],
      ephemeral: true,
    };
  }
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: type === 'skill' ? 'WHICH CAPABILITY?' : `WHICH ${label}?`,
        description: TYPE_DESCRIPTIONS[type],
        color: COLORS.chrome,
      }),
    ],
    components: [
      row(
        stringSelect(
          verificationId(ACTIONS.target, type),
          `Choose ${type === 'skill' ? 'a capability' : `a ${type}`}`,
          candidates.map(candidateOption),
        ),
      ),
    ],
    ephemeral: true,
  };
}

/** Step 2b (skill): the rank to request, above the current verified rank. */
async function rankPanel(h: HandlerContext, facetKey: string): Promise<ReplyPayload> {
  const candidates = await verification.listTargetCandidates(h.ctx, { type: 'skill' });
  const facet = candidates.find((candidate) => candidate.targetId === facetKey);
  if (!facet) throw new ValidationError('That capability cannot be requested right now.');
  const catalog = await loadCatalog(h.ctx);
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: `${facet.label.toUpperCase()} — WHICH RANK?`,
        description: `${facet.detail}. Request the rank your evidence demonstrates.`,
        color: COLORS.chrome,
      }),
    ],
    components: [
      row(
        stringSelect(
          verificationId(ACTIONS.rank, facetKey),
          'Choose a rank',
          facet.ranks.map((code) => ({
            label: code,
            value: code,
            description: clip(
              catalog.tiers.find((tier) => tier.code === code)?.description ?? code,
              OPTION_TEXT_CHARS,
            ),
          })),
        ),
      ),
    ],
    ephemeral: true,
  };
}

function titleFor(ref: TargetRef): string {
  const label = verification.TYPE_LABELS[ref.type];
  return clip(
    ref.type === 'skill' && ref.rank ? `VERIFY — ${label} AT ${ref.rank}` : `VERIFY — ${label}`,
    LIMITS.modalTitle,
  );
}

/** Step 3: claim and evidence. */
export function requestModal(ref: TargetRef): ModalPayload {
  const evidence = REQUEST_FIELDS.evidence.map((id, index) =>
    new LabelBuilder()
      .setLabel(`Evidence link ${index + 1}`)
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(id)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(verification.TEXT_LIMITS.url)
          .setPlaceholder('https://'),
      ),
  );
  return new ModalBuilder()
    .setCustomId(verificationId(ACTIONS.submit, ...targetArgs(ref)))
    .setTitle(titleFor(ref))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Claim')
        .setDescription('What exactly should be verified. Leave empty for the default.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(REQUEST_FIELDS.claim)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(verification.TEXT_LIMITS.claim),
        ),
      ...evidence,
    )
    .toJSON();
}

/** Continue the flow from whatever the member has chosen so far. */
export async function continueRequest(
  h: HandlerContext,
  type: VerificationType | null,
  target: string | null,
  rank: string | null,
): Promise<void> {
  if (!type) {
    await present(h, typePanel());
    return;
  }
  const ref = parseTargetRef(type, target, rank);
  if (!ref) {
    if (!isCandidateType(type)) throw new ValidationError('Choose a target.');
    await present(h, await targetPanel(h, type));
    return;
  }
  if (ref.type === 'skill' && !ref.rank) {
    await present(h, await rankPanel(h, ref.facetKey));
    return;
  }
  await h.interaction.showModal(requestModal(ref));
}

async function present(h: HandlerContext, payload: ReplyPayload): Promise<void> {
  const { interaction } = h;
  if (interaction.kind === 'button' || interaction.kind === 'select') {
    await interaction.update(payload);
    return;
  }
  await h.respond(payload);
}

/** Title for a link as evidence: its host and path, so the list reads well in the dashboard. */
export function evidenceTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const title = `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    return title.length >= 2 ? clip(title, EVIDENCE_TITLE_CHARS) : FALLBACK_EVIDENCE_TITLE;
  } catch {
    return FALLBACK_EVIDENCE_TITLE;
  }
}

/** Modal submit: `verification:submit:<type>[:target[:rank]]`. */
export async function submitRequest(h: HandlerContext, args: readonly string[]): Promise<void> {
  const type = parseType(args[0]);
  if (!type) throw new ValidationError('Unknown verification type.');
  const ref = parseTargetRef(type, args[1], args[2]);
  if (!ref) throw new ValidationError('Choose a target.');
  const { modal } = h.interaction;
  const claim = modal.text(REQUEST_FIELDS.claim).trim();
  const links = REQUEST_FIELDS.evidence
    .map((id) => modal.text(id).trim())
    .filter((url) => url.length > 0);
  const created = await verification.requestVerification(h.ctx, {
    target: toRequestTarget(ref),
    claim: claim || undefined,
    evidence: links.map((url) => ({ title: evidenceTitle(url), url })),
  });
  const rankNote = created.requestedRank ? ` at ${created.requestedRank}` : '';
  await h.respond({
    embeds: [
      success(
        `VERIFICATION REQUESTED — ${created.reference}`,
        [
          `${verification.TYPE_LABELS[created.type]}: ${userText(created.targetLabel, 200)}${rankNote}.`,
          `${created.evidenceCount} evidence item${created.evidenceCount === 1 ? '' : 's'} attached.`,
          created.expiresAt
            ? `A verifier decides before ${discordTime(created.expiresAt, 'f')}, or it expires.`
            : 'A verifier decides.',
          'You are notified of the decision.',
        ].join('\n'),
      ),
    ],
    components: [row(button('My verifications', verificationId(ACTIONS.status)))],
    ephemeral: true,
  });
}

/** Select handlers of the request flow; false when the action is not part of it. */
export async function handleRequestComponent(
  h: HandlerContext,
  action: string,
  args: readonly string[],
): Promise<boolean> {
  const [value] = h.interaction.values;
  switch (action) {
    case ACTIONS.start:
      await present(h, typePanel());
      return true;
    case ACTIONS.type:
      await continueRequest(h, parseTypeOrThrow(value), null, null);
      return true;
    case ACTIONS.target:
      await continueRequest(h, parseTypeOrThrow(args[0]), value ?? null, null);
      return true;
    case ACTIONS.rank:
      await continueRequest(h, 'skill', args[0] ?? null, value ?? null);
      return true;
    default:
      return false;
  }
}

function parseTypeOrThrow(value: string | undefined): VerificationType {
  const type = parseType(value);
  if (!type) throw new ValidationError('Unknown verification type.');
  return type;
}

/** Autocomplete for `/verify request target` and `rank`, from the member's own candidates. */
export async function requestAutocomplete(h: HandlerContext): Promise<AutocompleteChoice[]> {
  const focused = h.interaction.options.focused();
  const type = parseType(h.interaction.options.string('type'));
  if (!focused || !type || !isCandidateType(type)) return [];
  if (focused.name === 'target') {
    const candidates = await verification.listTargetCandidates(h.ctx, {
      type,
      search: focused.value.slice(0, AUTOCOMPLETE_QUERY_CHARS).trim() || undefined,
    });
    return candidates.map((candidate) => ({
      name: clip(`${candidate.label} ${GLYPH.dot} ${candidate.detail}`, OPTION_TEXT_CHARS),
      value: candidate.targetId,
    }));
  }
  if (focused.name === 'rank' && type === 'skill') {
    const facetKey = h.interaction.options.string('target');
    const candidates = await verification.listTargetCandidates(h.ctx, { type: 'skill' });
    const facet = candidates.find((candidate) => candidate.targetId === facetKey);
    const query = focused.value.trim().toUpperCase();
    return (facet?.ranks ?? [])
      .filter((code) => !query || code.startsWith(query))
      .map((code) => ({ name: code, value: code }));
  }
  return [];
}
