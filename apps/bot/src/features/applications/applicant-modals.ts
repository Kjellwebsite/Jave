import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { applications } from '@jave/core';
import type { ModalPayload } from '../../interactions/types';
import { clip } from '../../ui/format';
import { LIMITS } from '../../ui/theme';
import { APPLICANT_ACTIONS, applicationsId, type ModalPage } from './ids';

type FormField = applications.ApplicationFormField;
type ApplicantView = applications.ApplicantApplicationView;

const PAGE_TITLES: Readonly<Record<ModalPage, string>> = {
  1: 'APPLICATION — ANSWERS (1/2)',
  2: 'APPLICATION — REFERENCES (2/2)',
};

/** The text fields of one modal page, in form order. */
export function fieldsForPage(page: ModalPage): FormField[] {
  return applications.APPLICATION_FORM_FIELDS.filter(
    (entry) => entry.modalPage === page && entry.input !== 'select',
  );
}

/** The draft's current value for a field, as the modal shows it. */
function currentValue(app: ApplicantView, key: applications.ApplicationFormFieldKey): string {
  switch (key) {
    case 'motivation':
      return app.motivation ?? '';
    case 'experience':
      return app.experience ?? '';
    case 'projects':
      return app.projects ?? '';
    case 'portfolioUrl':
      return app.portfolioUrl ?? '';
    case 'evidenceLinks':
      return app.evidenceLinks.join(applications.EVIDENCE_LINK_SEPARATOR);
    case 'references':
      return app.references ?? '';
    case 'referralCode':
      return app.referralCode ?? '';
    case 'domainKey':
      return app.domainKey ?? '';
  }
}

function inputLimit(entry: FormField): number {
  return Math.min(entry.maxLength, applications.DISCORD_MODAL_LIMITS.inputChars);
}

/**
 * Fields of a page whose stored answer is longer than its modal input.
 * Core keeps every stored answer within its input, so this only catches
 * data written before a cap tightened; such a page must not open, because
 * a truncated prefill would be saved back over the full answer.
 */
export function oversizedFields(page: ModalPage, app: ApplicantView): FormField[] {
  return fieldsForPage(page).filter(
    (entry) => currentValue(app, entry.key).length > inputLimit(entry),
  );
}

/**
 * One page of the application form, prefilled with the draft. Every input is
 * optional so a partial save works; submission checks completeness. Check
 * oversizedFields first: a prefill is never cut short.
 */
export function applicationModal(page: ModalPage, app: ApplicantView): ModalPayload {
  const labels = fieldsForPage(page).map((entry) => {
    const limit = inputLimit(entry);
    const input = new TextInputBuilder()
      .setCustomId(entry.key)
      .setStyle(entry.input === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setMaxLength(limit)
      .setRequired(false)
      .setPlaceholder(clip(entry.placeholder, applications.DISCORD_MODAL_LIMITS.placeholderChars));
    const value = currentValue(app, entry.key);
    // An empty prefill is omitted: the placeholder shows instead.
    if (value) input.setValue(value);
    return new LabelBuilder()
      .setLabel(clip(entry.label, applications.DISCORD_MODAL_LIMITS.labelChars))
      .setTextInputComponent(input);
  });
  return new ModalBuilder()
    .setCustomId(applicationsId(APPLICANT_ACTIONS.save, page))
    .setTitle(clip(PAGE_TITLES[page], LIMITS.modalTitle))
    .addLabelComponents(...labels)
    .toJSON();
}
