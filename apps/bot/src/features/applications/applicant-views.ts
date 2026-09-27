import type { APIEmbedField } from 'discord.js';
import { applications } from '@jave/core';
import type { ReplyPayload } from '../../interactions/types';
import { button, field, linkButton, panel, row, stringSelect } from '../../ui/components';
import { clip, discordTime, userText } from '../../ui/format';
import { COLORS, GLYPH } from '../../ui/theme';
import { APPLICANT_ACTIONS, applicationsId } from './ids';
import { STATUS_COLORS, STATUS_LABELS } from './labels';

type MyApplication = applications.MyApplicationStatus;
type ApplicantView = applications.ApplicantApplicationView;

export interface DomainOption {
  key: string;
  label: string;
  description: string;
}

const KICKER = 'JAVELIN APPLICATION';
/** Answer excerpts in the panel; the full text is in the modal and the dashboard. */
const EXCERPT_CHARS = 160;
const SELECT_DESCRIPTION_CHARS = 100;

function formLabel(key: applications.ApplicationFormFieldKey): string {
  return (
    applications.APPLICATION_FORM_FIELDS.find((entry) => entry.key === key)?.label ?? key
  ).toUpperCase();
}

function excerpt(text: string | null): string {
  return text ? userText(text, EXCERPT_CHARS) : GLYPH.unknown;
}

function domainLabel(domains: readonly DomainOption[], key: string | null): string {
  if (!key) return GLYPH.unknown;
  return (domains.find((domain) => domain.key === key)?.label ?? key).toUpperCase();
}

function readinessField(app: ApplicantView): APIEmbedField {
  if (app.readiness.ready)
    return field('Ready to submit', `${GLYPH.verified} Every requirement is met.`);
  return field(
    'Missing before submission',
    app.readiness.missing
      .map((requirement) => `${GLYPH.cross} ${applications.REQUIREMENT_MESSAGES[requirement]}`)
      .join('\n'),
  );
}

function answerFields(app: ApplicantView, domains: readonly DomainOption[]): APIEmbedField[] {
  return [
    field(formLabel('domainKey'), domainLabel(domains, app.domainKey), true),
    field(
      formLabel('evidenceLinks'),
      app.evidenceLinks.length ? `${app.evidenceLinks.length} linked` : GLYPH.unknown,
      true,
    ),
    field(
      formLabel('referralCode'),
      app.referralCode ? userText(app.referralCode) : GLYPH.unknown,
      true,
    ),
    field(formLabel('motivation'), excerpt(app.motivation)),
    field(formLabel('experience'), excerpt(app.experience)),
    field(formLabel('projects'), excerpt(app.projects)),
    field(formLabel('portfolioUrl'), app.portfolioUrl ? userText(app.portfolioUrl) : GLYPH.unknown),
    field(
      formLabel('references'),
      app.references ? 'Provided — visible to staff only.' : GLYPH.unknown,
    ),
  ];
}

function domainSelect(domains: readonly DomainOption[], current: string | null) {
  return row(
    stringSelect(
      applicationsId(APPLICANT_ACTIONS.domain),
      'Primary domain — where you intend to prove yourself',
      domains.map((domain) => ({
        label: domain.label.toUpperCase(),
        value: domain.key,
        description: clip(domain.description, SELECT_DESCRIPTION_CHARS),
        default: domain.key === current,
      })),
    ),
  );
}

function draftPanel(status: MyApplication, app: ApplicantView, domains: readonly DomainOption[]) {
  const fields = [...answerFields(app, domains), readinessField(app)];
  if (app.draftExpiresAt)
    fields.push(field('Draft closes', `${discordTime(app.draftExpiresAt)} without edits.`, true));
  if (status.cooldownEndsAt)
    fields.push(field('Next submission', discordTime(status.cooldownEndsAt, 'f'), true));
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: `${app.number} — ${STATUS_LABELS.draft}`,
        description:
          'Only you can see this draft. Edit the answers, choose a domain, then submit. Staff see nothing until you do.',
        color: STATUS_COLORS.draft,
        fields,
      }),
    ],
    components: [
      domainSelect(domains, app.domainKey),
      row(
        button('Edit answers', applicationsId(APPLICANT_ACTIONS.edit, 1)),
        button('Edit references', applicationsId(APPLICANT_ACTIONS.edit, 2)),
        button('Submit', applicationsId(APPLICANT_ACTIONS.submit), 'primary'),
        button('Discard draft', applicationsId(APPLICANT_ACTIONS.withdraw), 'danger'),
      ),
    ],
  };
}

const IN_FLIGHT_COPY: Partial<Record<applications.ApplicationStatus, string>> = {
  submitted: 'Submitted. It is in the review queue; updates arrive by DM and in the dashboard.',
  review: 'A reviewer is working on it. Updates arrive by DM and in the dashboard.',
  interview: 'Staff want to talk to you before deciding. Details arrived with the invitation.',
};

function inFlightPanel(app: ApplicantView, domains: readonly DomainOption[]) {
  const fields: APIEmbedField[] = [
    field('Status', STATUS_LABELS[app.status], true),
    field(formLabel('domainKey'), domainLabel(domains, app.domainKey), true),
  ];
  if (app.submittedAt) fields.push(field('Submitted', discordTime(app.submittedAt, 'f'), true));
  if (app.interviewAt)
    fields.push(
      field(
        'Interview',
        `${discordTime(app.interviewAt, 'F')} ${GLYPH.dot} ${discordTime(app.interviewAt)}`,
      ),
    );
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: `${app.number} — ${STATUS_LABELS[app.status]}`,
        description: IN_FLIGHT_COPY[app.status],
        color: STATUS_COLORS[app.status],
        fields,
      }),
    ],
    components: [
      row(
        button('Refresh', applicationsId(APPLICANT_ACTIONS.panel)),
        button('Withdraw', applicationsId(APPLICANT_ACTIONS.withdraw), 'danger'),
      ),
    ],
  };
}

function closedPanel(status: MyApplication, app: ApplicantView | null) {
  const fields: APIEmbedField[] = [];
  let title = 'APPLY TO JAVELIN';
  let description =
    'Tell us what you build, research or pursue, and show proof of work. Staff review every application. Nothing is visible to them until you submit.';
  let color: number = COLORS.chrome;
  if (app) {
    title = `${app.number} — ${STATUS_LABELS[app.status]}`;
    color = STATUS_COLORS[app.status];
    description =
      app.status === 'accepted'
        ? 'Accepted. Your role was updated; ranks are earned through trials and verification.'
        : 'This application is closed. You can start a new one.';
    if (app.decidedAt) fields.push(field('Decided', discordTime(app.decidedAt, 'f'), true));
    if (app.applicantMessage)
      fields.push(field('Message from staff', userText(app.applicantMessage)));
  }
  if (status.cooldownEndsAt)
    fields.push(
      field(
        'Next submission',
        `${discordTime(status.cooldownEndsAt, 'f')}. You can prepare a draft before then.`,
      ),
    );
  if (!status.applicationsOpen) {
    return {
      embeds: [
        panel({
          kicker: KICKER,
          title: app ? title : 'APPLICATIONS CLOSED',
          description: 'New applications are paused. Check back later.',
          color: COLORS.steel,
          fields,
        }),
      ],
      components: [],
    };
  }
  return {
    embeds: [panel({ kicker: KICKER, title, description, color, fields })],
    components: [
      row(
        button(
          app ? 'Start new application' : 'Start application',
          applicationsId(APPLICANT_ACTIONS.start),
          'primary',
        ),
      ),
    ],
  };
}

/** The /apply panel: status, eligibility, cooldown and the actions that can succeed now. */
export function renderApplicantPanel(
  status: MyApplication,
  domains: readonly DomainOption[],
): ReplyPayload {
  const app = status.application;
  const open = app && applications.isOpenStatus(app.status) ? app : null;
  if (!open && !status.eligible) {
    return {
      embeds: [
        panel({
          kicker: KICKER,
          title: 'ALREADY INSIDE JAVELIN',
          description:
            'Your roles already place you inside JAVELIN. No application needed. Prove capability through trials and verification.',
          color: COLORS.chrome,
        }),
      ],
      components: [],
      ephemeral: true,
    };
  }
  const view = !open
    ? closedPanel(status, app)
    : open.status === 'draft'
      ? draftPanel(status, open, domains)
      : inFlightPanel(open, domains);
  return { ...view, ephemeral: true };
}

/** /apply status: where the application stands and how it got there. */
export function renderApplicantStatus(
  status: MyApplication,
  domains: readonly DomainOption[],
): ReplyPayload {
  const app = status.application;
  if (!app) {
    return {
      embeds: [
        panel({
          kicker: KICKER,
          title: 'NO APPLICATION',
          description: status.eligible
            ? 'You have not applied yet. Use /apply start.'
            : 'Your roles already place you inside JAVELIN. No application needed.',
          color: COLORS.steel,
        }),
      ],
      ephemeral: true,
    };
  }
  const timeline = app.timeline
    .map((entry) => `${discordTime(entry.at, 'f')} ${GLYPH.bar} ${STATUS_LABELS[entry.status]}`)
    .join('\n');
  const fields: APIEmbedField[] = [
    field('Status', STATUS_LABELS[app.status], true),
    field(formLabel('domainKey'), domainLabel(domains, app.domainKey), true),
  ];
  if (app.interviewAt) fields.push(field('Interview', discordTime(app.interviewAt, 'F'), true));
  if (status.cooldownEndsAt)
    fields.push(field('Next submission', discordTime(status.cooldownEndsAt, 'f'), true));
  if (app.applicantMessage)
    fields.push(field('Message from staff', userText(app.applicantMessage)));
  fields.push(field('Timeline', timeline || GLYPH.unknown));
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: `${app.number} — ${STATUS_LABELS[app.status]}`,
        color: STATUS_COLORS[app.status],
        fields,
      }),
    ],
    components: [row(button('Open application', applicationsId(APPLICANT_ACTIONS.panel)))],
    ephemeral: true,
  };
}

/** Submission refused because requirements are missing: list every one, with the way to fix it. */
export function renderMissingRequirements(issues: readonly string[]): ReplyPayload {
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: `${GLYPH.cross} NOT READY TO SUBMIT`,
        description: issues.map((issue) => `${GLYPH.cross} ${issue}`).join('\n'),
        color: COLORS.warning,
        footer: 'Nothing was sent. Fix the items above, then submit again.',
      }),
    ],
    components: [
      row(
        button('Edit answers', applicationsId(APPLICANT_ACTIONS.edit, 1)),
        button('Back to application', applicationsId(APPLICANT_ACTIONS.panel)),
      ),
    ],
    ephemeral: true,
  };
}

/**
 * Withdrawal needs a second click; it states what withdrawing costs first.
 * The cost depends on the status, so the confirm button carries the
 * application and status it was stated for: if either changed by the time
 * it is clicked, core withdraws nothing and the cost is stated again.
 * `notice` says why a confirmation is shown again.
 */
export function renderWithdrawConfirm(
  status: MyApplication,
  app: ApplicantView,
  notice?: string,
): ReplyPayload {
  const draft = app.status === 'draft';
  const cost = status.withdrawalCooldownEndsAt
    ? `You can submit again from ${discordTime(status.withdrawalCooldownEndsAt, 'f')}.`
    : 'You can start again at any time.';
  const consequence = draft
    ? 'The draft closes. Staff never saw it.'
    : 'The application leaves the review queue and closes.';
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: draft ? `DISCARD ${app.number}?` : `WITHDRAW ${app.number}?`,
        description: [notice, `${consequence} ${cost}`].filter(Boolean).join('\n\n'),
        color: COLORS.warning,
      }),
    ],
    components: [
      row(
        button(
          draft ? 'Discard draft' : 'Withdraw application',
          applicationsId(APPLICANT_ACTIONS.withdrawConfirm, app.id, app.status),
          'danger',
        ),
        button('Keep it', applicationsId(APPLICANT_ACTIONS.panel)),
      ),
    ],
    ephemeral: true,
  };
}

/** A form page cannot be opened because a stored answer is longer than a Discord input. */
export function renderTooLongToEdit(labels: readonly string[], dashboardUrl: string | null) {
  return {
    embeds: [
      panel({
        kicker: KICKER,
        title: 'EDIT IN THE DASHBOARD',
        description: `${labels.join(', ')} ${labels.length === 1 ? 'is' : 'are'} longer than a Discord form holds (${applications.DISCORD_MODAL_LIMITS.inputChars} characters). Opening the form here would cut ${labels.length === 1 ? 'it' : 'them'} short, so nothing was opened. Edit this page in the dashboard.`,
        color: COLORS.warning,
      }),
    ],
    components: [
      row(
        ...(dashboardUrl ? [linkButton('Open in dashboard', dashboardUrl)] : []),
        button('Back to application', applicationsId(APPLICANT_ACTIONS.panel)),
      ),
    ],
    ephemeral: true,
  } satisfies ReplyPayload;
}
