import { SlashCommandBuilder } from 'discord.js';
import { applications, InvalidStateError, loadCatalog, ValidationError } from '@jave/core';
import type { CommandDefinition, HandlerContext, ReplyPayload } from '../../interactions/types';
import { button, row, success } from '../../ui/components';
import { discordTime } from '../../ui/format';
import { applicationModal, fieldsForPage } from './applicant-modals';
import {
  type DomainOption,
  renderApplicantPanel,
  renderApplicantStatus,
  renderMissingRequirements,
  renderWithdrawConfirm,
} from './applicant-views';
import { APPLICANT_ACTIONS, applicationsId, parseModalPage } from './ids';

const REQUIREMENT_KEYS = new Set(Object.keys(applications.REQUIREMENT_MESSAGES));

async function loadDomains(h: HandlerContext): Promise<DomainOption[]> {
  const catalog = await loadCatalog(h.ctx);
  return catalog.domains.map((domain) => ({
    key: domain.key,
    label: domain.label,
    description: domain.description,
  }));
}

/** Replace the panel in place when a panel control was used; otherwise answer privately. */
async function present(h: HandlerContext, payload: ReplyPayload): Promise<void> {
  const { interaction } = h;
  if ((interaction.kind === 'button' || interaction.kind === 'select') && !interaction.replied) {
    await interaction.update(payload);
    return;
  }
  await h.respond({ ...payload, ephemeral: true });
}

async function panelPayload(h: HandlerContext): Promise<ReplyPayload> {
  const [status, domains] = await Promise.all([
    applications.getMyApplication(h.ctx),
    loadDomains(h),
  ]);
  return renderApplicantPanel(status, domains);
}

async function showPanel(h: HandlerContext): Promise<void> {
  await present(h, await panelPayload(h));
}

async function openDraft(h: HandlerContext): Promise<applications.ApplicantApplicationView> {
  const { application } = await applications.getMyApplication(h.ctx);
  if (!application || application.status !== 'draft') {
    throw new InvalidStateError('There is no draft to edit. Open /apply start to begin one.');
  }
  return application;
}

function isMissingRequirements(error: unknown): error is ValidationError {
  return (
    error instanceof ValidationError &&
    error.issues.length > 0 &&
    error.issues.every((issue) => REQUIREMENT_KEYS.has(issue.path))
  );
}

async function submit(h: HandlerContext): Promise<void> {
  try {
    const submitted = await applications.submitApplication(h.ctx);
    await present(h, {
      embeds: [
        success(
          `APPLICATION SUBMITTED — ${submitted.number}`,
          'It is in the review queue. Staff decide; updates arrive by DM and in the dashboard. Withdrawing later starts a short cooldown.',
        ),
      ],
      components: [row(button('View application', applicationsId(APPLICANT_ACTIONS.panel)))],
      ephemeral: true,
    });
  } catch (error) {
    if (!isMissingRequirements(error)) throw error;
    await present(h, renderMissingRequirements(error.issues.map((issue) => issue.message)));
  }
}

async function withdraw(h: HandlerContext): Promise<void> {
  const status = await applications.getMyApplication(h.ctx);
  const app = status.application;
  if (!app || !applications.isOpenStatus(app.status)) {
    await present(h, renderApplicantPanel(status, await loadDomains(h)));
    return;
  }
  await present(h, renderWithdrawConfirm(status));
}

async function confirmWithdraw(h: HandlerContext): Promise<void> {
  const before = await applications.getMyApplication(h.ctx);
  const withdrawn = await applications.withdrawApplication(h.ctx);
  const wasDraft = before.application?.status === 'draft';
  const after = await applications.getMyApplication(h.ctx);
  const next = after.cooldownEndsAt
    ? `You can submit again from ${discordTime(after.cooldownEndsAt, 'f')}.`
    : 'You can start again at any time.';
  await present(h, {
    embeds: [
      success(
        wasDraft
          ? `DRAFT DISCARDED — ${withdrawn.number}`
          : `APPLICATION WITHDRAWN — ${withdrawn.number}`,
        next,
      ),
    ],
    components: [],
    ephemeral: true,
  });
}

async function editPage(h: HandlerContext, pageArg: string | undefined): Promise<void> {
  const page = parseModalPage(pageArg);
  if (!page) throw new ValidationError('Unknown form page.');
  const draft = await openDraft(h);
  await h.interaction.showModal(applicationModal(page, draft));
}

/** Names each refused answer by its form label instead of its input key. */
function labelledDraftError(error: ValidationError): ValidationError {
  const lines = error.issues.map((issue) => {
    const key = issue.path.split('.')[0];
    const label = applications.APPLICATION_FORM_FIELDS.find((entry) => entry.key === key)?.label;
    return label ? `${label}: ${issue.message}` : issue.message;
  });
  return new ValidationError(['Nothing was saved.', ...lines].join('\n'), error.issues);
}

async function savePage(h: HandlerContext, pageArg: string | undefined): Promise<void> {
  const page = parseModalPage(pageArg);
  if (!page) throw new ValidationError('Unknown form page.');
  const patch: applications.UpdateDraftInput = Object.fromEntries(
    fieldsForPage(page).map((entry) => [entry.key, h.interaction.modal.text(entry.key)]),
  );
  await applications.updateDraft(h.ctx, patch).catch((error: unknown) => {
    if (error instanceof ValidationError && error.issues.length > 0)
      throw labelledDraftError(error);
    throw error;
  });
  const payload = await panelPayload(h);
  await h.respond({
    ...payload,
    embeds: [success('DRAFT SAVED'), ...(payload.embeds ?? [])],
    ephemeral: true,
  });
}

async function chooseDomain(h: HandlerContext): Promise<void> {
  const [domainKey] = h.interaction.values;
  if (!domainKey) throw new ValidationError('Choose a domain.');
  await applications.updateDraft(h.ctx, { domainKey });
  await showPanel(h);
}

async function start(h: HandlerContext): Promise<void> {
  await applications.getOrCreateDraft(h.ctx);
  await showPanel(h);
}

/** Applicant component actions; returns false when the action is not an applicant one. */
export async function handleApplicantComponent(
  h: HandlerContext,
  action: string,
  args: readonly string[],
): Promise<boolean> {
  switch (action) {
    case APPLICANT_ACTIONS.panel:
      await showPanel(h);
      return true;
    case APPLICANT_ACTIONS.start:
      await start(h);
      return true;
    case APPLICANT_ACTIONS.domain:
      await chooseDomain(h);
      return true;
    case APPLICANT_ACTIONS.edit:
      await editPage(h, args[0]);
      return true;
    case APPLICANT_ACTIONS.submit:
      await submit(h);
      return true;
    case APPLICANT_ACTIONS.withdraw:
      await withdraw(h);
      return true;
    case APPLICANT_ACTIONS.withdrawConfirm:
      await confirmWithdraw(h);
      return true;
    default:
      return false;
  }
}

/** Applicant modal submissions; returns false when the action is not an applicant one. */
export async function handleApplicantModal(
  h: HandlerContext,
  action: string,
  args: readonly string[],
): Promise<boolean> {
  if (action !== APPLICANT_ACTIONS.save) return false;
  await savePage(h, args[0]);
  return true;
}

export const applyCommand: CommandDefinition = {
  kind: 'slash',
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Apply to JAVELIN, or see where your application stands.')
    .addSubcommand((s) =>
      s.setName('start').setDescription('Open your application: edit, submit or withdraw.'),
    )
    .addSubcommand((s) =>
      s.setName('status').setDescription('Where your application stands, with its timeline.'),
    )
    .toJSON(),
  help: {
    category: 'progression',
    summary: 'Apply to JAVELIN and follow your application.',
    usage: '/apply start | status',
  },
  async execute(h) {
    if (h.interaction.options.subcommand() === 'status') {
      const [status, domains] = await Promise.all([
        applications.getMyApplication(h.ctx),
        loadDomains(h),
      ]);
      await h.respond(renderApplicantStatus(status, domains));
      return;
    }
    await h.respond(await panelPayload(h));
  },
};
