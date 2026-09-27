import type { APIEmbedField } from 'discord.js';
import { verification } from '@jave/core';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, linkButton, panel, row, stringSelect } from '../../ui/components';
import { dashboardLink } from '../applications/dashboard-link';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { ACTIONS, verificationId } from './ids';
import { OPENED_BY_LABELS, STATUS_COLORS } from './labels';

type Detail = verification.VerificationDetail;
type Summary = verification.VerificationSummary;

const CLAIM_CHARS = 500;
const EVIDENCE_TITLE_CHARS = 120;
const EVIDENCE_URL_CHARS = 200;
const EVIDENCE_LISTED = 10;
const NOTE_CHARS = 900;
const OPTION_TEXT_CHARS = 100;
const NAME_CHARS = 80;

export function dashboardVerificationPath(id: string): string {
  return `/verification/${id}`;
}

/** `SKILL: Research at A` — the target in one line (user text escaped). */
export function targetLine(v: {
  type: verification.VerificationType;
  targetLabel: string;
  requestedRank: string | null;
  grantedRank: string | null;
}): string {
  const rank = v.grantedRank
    ? ` ${GLYPH.dot} verified at ${v.grantedRank}`
    : v.requestedRank
      ? ` at ${v.requestedRank}`
      : '';
  return `${verification.TYPE_LABELS[v.type]}: ${userText(v.targetLabel, 200)}${rank}`;
}

export function subjectLine(subject: { displayName: string; handle: string }): string {
  return `${userText(subject.displayName, NAME_CHARS)} ${GLYPH.dot} @${userText(subject.handle, NAME_CHARS)}`;
}

function evidenceLines(detail: Detail): string {
  if (detail.evidence.length === 0) return 'None attached.';
  return detail.evidence
    .slice(0, EVIDENCE_LISTED)
    .map((item) => {
      const url = item.url ? `\n  ${userText(item.url, EVIDENCE_URL_CHARS)}` : '';
      return `${GLYPH.bullet} ${userText(item.title, EVIDENCE_TITLE_CHARS)} ${GLYPH.dot} ${item.status.toUpperCase()}${url}`;
    })
    .join('\n');
}

export interface DetailViewer {
  /** Holds canVerifyMembers (the staff view). */
  staff: boolean;
  /** What core says this viewer can do here now. */
  access: verification.VerificationAccess;
}

const CONTROL_BUTTONS: Readonly<
  Record<
    verification.VerificationControl,
    { label: string; action: string; style: 'primary' | 'success' | 'danger' }
  >
> = {
  start_review: { label: 'Start review', action: ACTIONS.claim, style: 'primary' },
  approve: { label: 'Approve', action: ACTIONS.approve, style: 'success' },
  reject: { label: 'Reject', action: ACTIONS.reject, style: 'danger' },
  revoke: { label: 'Revoke', action: ACTIONS.revoke, style: 'danger' },
};

/** Buttons for the controls core offers this viewer. Core re-checks each on click. */
function staffControls(detail: Detail, viewer: DetailViewer) {
  return viewer.access.controls.map((control) => {
    const spec = CONTROL_BUTTONS[control];
    return button(spec.label, verificationId(spec.action, detail.id), spec.style);
  });
}

/**
 * One verification. The subject sees status, claim, target, evidence and the
 * decision note; verifiers also see who requested, assigned and decided.
 */
export function renderDetail(
  detail: Detail,
  viewer: DetailViewer,
  publicUrl: string | undefined,
): ReplyPayload {
  const fields: APIEmbedField[] = [
    field('Status', verification.STATUS_LABELS[detail.status], true),
    field('Subject', subjectLine(detail.subject), true),
    field('Opened by', OPENED_BY_LABELS[detail.openedBy], true),
    field('Target', targetLine(detail)),
    field('Requested', discordTime(detail.requestedAt, 'f'), true),
  ];
  if (detail.expiresAt && verification.isOpen(detail.status))
    fields.push(field('Expires', discordTime(detail.expiresAt), true));
  if (detail.decidedAt) fields.push(field('Decided', discordTime(detail.decidedAt, 'f'), true));
  if (viewer.staff)
    fields.push(
      field(
        'Verifier',
        detail.assignedVerifier ? userText(detail.assignedVerifier.name, NAME_CHARS) : 'Unassigned',
        true,
      ),
    );
  fields.push(field(`Evidence (${detail.evidenceCount})`, evidenceLines(detail)));
  if (detail.decisionNote)
    fields.push(field('Decision note', userText(detail.decisionNote, NOTE_CHARS)));
  if (detail.revokeReason)
    fields.push(field('Revocation reason', userText(detail.revokeReason, NOTE_CHARS)));
  if (detail.staff) {
    const people = [
      detail.staff.requestedBy
        ? `Requested by ${userText(detail.staff.requestedBy.name, NAME_CHARS)}`
        : '',
      detail.staff.verifier ? `Decided by ${userText(detail.staff.verifier.name, NAME_CHARS)}` : '',
      detail.staff.revokedBy
        ? `Revoked by ${userText(detail.staff.revokedBy.name, NAME_CHARS)}`
        : '',
    ].filter(Boolean);
    if (people.length) fields.push(field('Staff record', people.join('\n')));
  }
  const blocked = viewer.access.blocked;
  if (blocked && blocked !== 'closed')
    fields.push(field('Your controls', verification.VERIFICATION_BLOCK_MESSAGES[blocked]));

  const controls = staffControls(detail, viewer);
  // The subject may open it too: the dashboard shows each viewer only what they may see.
  const url = dashboardLink(publicUrl, dashboardVerificationPath(detail.id));
  const links = url ? [linkButton('Open in dashboard', url)] : [];
  return {
    embeds: [
      panel({
        kicker: viewer.staff ? 'VERIFICATION — STAFF VIEW' : 'VERIFICATION',
        title: `${detail.reference} — ${verification.TYPE_LABELS[detail.type]}`,
        description: userText(detail.claim, CLAIM_CHARS),
        color: STATUS_COLORS[detail.status],
        fields,
      }),
    ],
    components: [
      ...(controls.length ? [row(...controls)] : []),
      ...(links.length ? [row(...links)] : []),
    ],
    ephemeral: true,
  };
}

function summaryLine(item: Summary): string {
  const when =
    verification.isOpen(item.status) && item.expiresAt
      ? `expires ${discordTime(item.expiresAt)}`
      : discordTime(item.requestedAt, 'd');
  return `**${item.reference}** ${GLYPH.dot} ${targetLine(item)} ${GLYPH.dot} ${verification.STATUS_LABELS[item.status]} ${GLYPH.dot} ${when}`;
}

function summaryOption(item: Summary) {
  return {
    label: clip(
      `${item.reference} — ${verification.STATUS_LABELS[item.status]}`,
      OPTION_TEXT_CHARS,
    ),
    value: item.id,
    description: clip(
      `${verification.TYPE_LABELS[item.type]}: ${item.targetLabel}`,
      OPTION_TEXT_CHARS,
    ),
  };
}

/** The member's own verifications in the dashboard (the page lists only theirs). */
const DASHBOARD_MINE_PATH = '/verification?status=all';

/** /verify status: the member's own verifications, newest first. */
export function renderMine(
  page: verification.VerificationSummary[],
  total: number,
  publicUrl: string | undefined,
): ReplyPayload {
  const url = dashboardLink(publicUrl, DASHBOARD_MINE_PATH);
  if (page.length === 0) {
    return {
      embeds: [
        panel({
          kicker: 'VERIFICATION',
          title: 'NO VERIFICATIONS YET',
          description:
            'Put a claim forward with /verify request. A verifier who is not you decides.',
          color: COLORS.steel,
        }),
      ],
      components: [row(button('Request verification', verificationId(ACTIONS.start), 'primary'))],
      ephemeral: true,
    };
  }
  return {
    embeds: [
      panel({
        kicker: 'VERIFICATION',
        title: 'YOUR VERIFICATIONS',
        description: page.map(summaryLine).join('\n'),
        color: COLORS.base,
        footer:
          total > page.length
            ? `Newest ${page.length} of ${total}. All of them in the dashboard.`
            : undefined,
      }),
    ],
    components: [
      row(
        stringSelect(verificationId(ACTIONS.mine), 'Open a verification', page.map(summaryOption)),
      ),
      row(
        button('Request verification', verificationId(ACTIONS.start)),
        ...(url ? [linkButton('Open in dashboard', url)] : []),
      ),
    ],
    ephemeral: true,
  };
}

/** Staff context menu: one member's verifications, newest first. */
export function renderMemberVerifications(
  member: { displayName: string; handle: string },
  page: verification.VerificationSummary[],
  total: number,
): ReplyPayload {
  const title = `VERIFICATIONS — ${userText(member.displayName, NAME_CHARS)}`;
  if (page.length === 0) {
    return {
      embeds: [
        panel({
          kicker: 'VERIFICATION — STAFF VIEW',
          title,
          description: `@${userText(member.handle, NAME_CHARS)} has no verifications on record.`,
          color: COLORS.steel,
        }),
      ],
      components: [],
      ephemeral: true,
    };
  }
  return {
    embeds: [
      panel({
        kicker: 'VERIFICATION — STAFF VIEW',
        title,
        description: page.map(summaryLine).join('\n'),
        color: COLORS.base,
        footer:
          total > page.length
            ? `Newest ${page.length} of ${total}. All of them in the dashboard.`
            : undefined,
      }),
    ],
    components: [
      row(
        stringSelect(verificationId(ACTIONS.pick), 'Open a verification', page.map(summaryOption)),
      ),
    ],
    ephemeral: true,
  };
}

export type QueueScope = 'open' | 'mine' | 'unassigned' | 'approved';
export const QUEUE_SCOPES: readonly QueueScope[] = ['open', 'mine', 'unassigned', 'approved'];
export const QUEUE_TITLES: Readonly<Record<QueueScope, string>> = {
  open: 'VERIFICATION QUEUE',
  mine: 'ASSIGNED TO YOU',
  unassigned: 'UNASSIGNED',
  approved: 'APPROVED',
};

/** /verify queue: one page, a select to open an item, paging when there is more. */
export function renderQueue(
  page: verification.VerificationSummary[],
  total: number,
  scope: QueueScope,
  offset: number,
  pageSize: number,
): ReplyPayload {
  if (page.length === 0) {
    return {
      embeds: [
        panel({
          kicker: 'VERIFICATION',
          title: QUEUE_TITLES[scope],
          description:
            offset > 0
              ? 'No more verifications on this page.'
              : 'Nothing here. The queue is clear.',
          color: COLORS.steel,
        }),
      ],
      components: [],
      ephemeral: true,
    };
  }
  const lines = page.map((item) => {
    const assignee = item.assignedVerifier
      ? userText(item.assignedVerifier.name, 40)
      : 'unassigned';
    return `${summaryLine(item)} ${GLYPH.dot} ${subjectLine(item.subject)} ${GLYPH.dot} ${assignee}`;
  });
  const paging = [
    ...(offset > 0
      ? [button('Previous', verificationId(ACTIONS.page, Math.max(0, offset - pageSize), scope))]
      : []),
    ...(offset + page.length < total
      ? [button('Next', verificationId(ACTIONS.page, offset + pageSize, scope))]
      : []),
  ];
  return {
    embeds: [
      panel({
        kicker: 'VERIFICATION',
        title: QUEUE_TITLES[scope],
        description: clip(lines.join('\n'), 4000),
        color: COLORS.base,
        footer: `${offset + 1}–${offset + page.length} of ${total}`,
      }),
    ],
    components: [
      row(
        stringSelect(verificationId(ACTIONS.pick), 'Open a verification', page.map(summaryOption)),
      ),
      ...(paging.length ? [row(...paging)] : []),
    ],
    ephemeral: true,
  };
}
