import { customId } from '../../interactions/custom-id';

/** Custom-id namespace of the trials feature. Ids route; every handler re-authorizes. */
export const TRIALS_NS = 'trials';

/** Member-facing component and modal actions. */
export const MEMBER_ACTIONS = {
  apply: 'apply',
  view: 'view',
  withdraw: 'withdraw',
  withdrawConfirm: 'withdraw-yes',
  submit: 'submit',
  status: 'status',
  team: 'team',
  /** Select menu: pick a trial for `purpose`. */
  pick: 'pick',
  /**
   * Show the trial IN PLACE of the member's own ephemeral message that holds
   * the button (Refresh, /team, receipts). Never put on a public message: the
   * press edits the message it came from. Args: trial id, REFERENCE flag.
   */
  open: 'open',
} as const;

/**
 * Whether the trial's reference messages (brief, rubric) already sit below the
 * member's view: an in-place refresh re-sends them only when they do not.
 */
export const REFERENCE = { shown: '1', absent: '0' } as const;
export type ReferenceFlag = (typeof REFERENCE)[keyof typeof REFERENCE];

/** Staff control-panel actions (all re-checked by the core services). */
export const STAFF_ACTIONS = {
  panel: 'panel',
  /** Confirmation step for a one-click operation. */
  ask: 'ask',
  /** Execute a confirmed operation. */
  run: 'run',
  selectRandom: 'sel-random',
  selectManual: 'sel-manual',
  selectPick: 'sel-pick',
  assign: 'assign',
  extend: 'extend',
  cancel: 'cancel',
  evaluate: 'eval',
  evaluateTeam: 'eval-team',
} as const;

/** One-click operations that go through a confirmation step. */
export const CONFIRMED_OPERATIONS = [
  'open',
  'start',
  'close',
  'publish',
  'publish-incomplete',
  'reprovision',
  'cancel',
] as const;
export type ConfirmedOperation = (typeof CONFIRMED_OPERATIONS)[number];

export function isConfirmedOperation(value: string | undefined): value is ConfirmedOperation {
  return (CONFIRMED_OPERATIONS as readonly string[]).includes(value ?? '');
}

/** What a trial picker select menu is for. */
export const PICK_PURPOSES = ['view', 'apply', 'withdraw', 'submit', 'manage'] as const;
export type PickPurpose = (typeof PICK_PURPOSES)[number];

export function isPickPurpose(value: string | undefined): value is PickPurpose {
  return (PICK_PURPOSES as readonly string[]).includes(value ?? '');
}

export function trialsId(action: string, ...args: (string | number)[]): string {
  return customId(TRIALS_NS, action, ...args);
}

/** Modal field ids. */
export const FIELDS = {
  statement: 'statement',
  summary: 'summary',
  links: 'links',
  count: 'count',
  seed: 'seed',
  strategy: 'strategy',
  teamSize: 'teamSize',
  minutes: 'minutes',
  reason: 'reason',
  notes: 'notes',
  /** Quick evaluation: one field per rubric criterion, `score-<index>`. */
  scorePrefix: 'score-',
} as const;
