import { APPLICATION_FIELD_LIMITS } from './schemas';

/**
 * The application form as data, so the bot's modals and the dashboard form
 * render identical fields with the service's own caps.
 *
 * Discord limits: 5 inputs per modal, labels ≤ 45 characters, placeholders
 * ≤ 100 characters, input length ≤ 4000. The domain is a select menu shown
 * before the modals; the text fields split over two modal pages.
 */
export const DISCORD_MODAL_LIMITS = {
  inputsPerModal: 5,
  labelChars: 45,
  placeholderChars: 100,
  inputChars: 4000,
} as const;

export type ApplicationFormFieldKey =
  | 'domainKey'
  | 'motivation'
  | 'experience'
  | 'projects'
  | 'portfolioUrl'
  | 'evidenceLinks'
  | 'references'
  | 'referralCode';

export interface ApplicationFormField {
  key: ApplicationFormFieldKey;
  label: string;
  placeholder: string;
  input: 'select' | 'short' | 'paragraph';
  maxLength: number;
  /** Required on its own for submission. Proof of work needs one of projects/portfolio/evidence. */
  required: boolean;
  /** Counts toward the proof-of-work requirement. */
  proofOfWork: boolean;
  /** Visible to the applicant and staff with canViewApplications only; never on the review card. */
  private: boolean;
  /** 0 = select menu before the modals; 1 and 2 = modal pages. */
  modalPage: 0 | 1 | 2;
}

export const APPLICATION_FORM_FIELDS: readonly ApplicationFormField[] = [
  {
    key: 'domainKey',
    label: 'Primary domain',
    placeholder: 'Where you intend to prove yourself.',
    input: 'select',
    maxLength: APPLICATION_FIELD_LIMITS.domainKey,
    required: true,
    proofOfWork: false,
    private: false,
    modalPage: 0,
  },
  {
    key: 'motivation',
    label: 'Why JAVELIN',
    placeholder: 'What you want to build or achieve here, and why now.',
    input: 'paragraph',
    maxLength: APPLICATION_FIELD_LIMITS.motivation,
    required: true,
    proofOfWork: false,
    private: false,
    modalPage: 1,
  },
  {
    key: 'experience',
    label: 'Experience',
    placeholder: 'What you have done. Be specific: scope, role, results.',
    input: 'paragraph',
    maxLength: APPLICATION_FIELD_LIMITS.experience,
    required: true,
    proofOfWork: false,
    private: false,
    modalPage: 1,
  },
  {
    key: 'projects',
    label: 'Projects',
    placeholder: 'What you built, shipped, won or published.',
    input: 'paragraph',
    maxLength: APPLICATION_FIELD_LIMITS.projects,
    required: false,
    proofOfWork: true,
    private: false,
    modalPage: 1,
  },
  {
    key: 'portfolioUrl',
    label: 'Portfolio URL',
    placeholder: 'https://',
    input: 'short',
    maxLength: APPLICATION_FIELD_LIMITS.portfolioUrl,
    required: false,
    proofOfWork: true,
    private: false,
    modalPage: 1,
  },
  {
    key: 'evidenceLinks',
    label: 'Evidence links',
    placeholder: 'Up to 10 http(s) links, one per line.',
    input: 'paragraph',
    maxLength: APPLICATION_FIELD_LIMITS.evidenceLinksText,
    required: false,
    proofOfWork: true,
    private: false,
    modalPage: 1,
  },
  {
    key: 'references',
    label: 'References (staff only)',
    placeholder: 'Who can vouch for your work, and how to reach them.',
    input: 'paragraph',
    maxLength: APPLICATION_FIELD_LIMITS.references,
    required: false,
    proofOfWork: false,
    private: true,
    modalPage: 2,
  },
  {
    key: 'referralCode',
    label: 'Referral code',
    placeholder: 'Optional.',
    input: 'short',
    maxLength: APPLICATION_FIELD_LIMITS.referralCode,
    required: false,
    proofOfWork: false,
    private: false,
    modalPage: 2,
  },
];
