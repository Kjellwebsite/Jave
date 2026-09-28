/** Custom-id namespace of every projects/contributions component and modal. */
export const PROJECTS_NS = 'projects';

/** Projects per /project list page. */
export const LIST_PAGE_SIZE = 10;
/** Projects offered by autocomplete pickers (Discord shows at most 25 choices). */
export const PICKER_LIMIT = 25;
/** Contributions per /contribute list page. */
export const CONTRIBUTION_PAGE_SIZE = 10;
/** Submitted contributions scanned to build one reviewer's queue. */
export const REVIEW_QUEUE_WINDOW = 100;

/** Rendering caps for the project card. */
export const CARD_MEMBERS_SHOWN = 12;
export const CARD_MILESTONES_SHOWN = 8;
export const CARD_LINKS_SHOWN = 8;
export const SUMMARY_MAX = 280;
export const DESCRIPTION_PREVIEW_MAX = 600;
export const LINE_TEXT_MAX = 80;

/** Modal input limits (Discord caps paragraph inputs at 4000 characters). */
export const MODAL_TEXT_MAX = 4000;
export const PROJECT_TITLE_MIN = 2;
export const PROJECT_TITLE_MAX = 120;
export const CONTRIBUTION_TITLE_MIN = 3;
export const CONTRIBUTION_TITLE_MAX = 200;
export const MILESTONE_TITLE_MAX = 120;
export const MILESTONE_DESCRIPTION_MAX = 2000;
export const REJECT_REASON_MIN = 3;
export const REJECT_REASON_MAX = 1000;
export const URL_MAX = 2048;
/** `YYYY-MM-DD`. */
export const DATE_INPUT_LENGTH = 10;

/** Discord caps autocomplete choice names at 100 characters. */
export const CHOICE_NAME_MAX = 100;

/** Placeholder id argument for "no project" in custom ids. */
export const NO_PROJECT = 'none';
