import { customId } from '../../interactions/custom-id';

/** Custom-id namespace for every moderation component and modal. */
export const MOD_NS = 'moderation';

/**
 * Component / modal actions. Custom ids route; they never authorize — every
 * handler re-checks the clicking user through @jave/core.
 */
export const MOD_ACTIONS = {
  /** Alert card buttons: `moderation:sec-ack:<securityEventId>` … */
  securityAcknowledge: 'sec-ack',
  securityDismiss: 'sec-dismiss',
  securityQuarantine: 'sec-q',
  /** Modal: quarantine from an alert card. */
  securityQuarantineSubmit: 'sec-q-submit',
  /** Select on a history view: take an action on the member. */
  takeAction: 'act',
  /** Modal: reason (+ duration) for an action. */
  actionSubmit: 'act-submit',
  /** Select on a history view: open one of the member's cases. */
  openCase: 'case-open',
  /** Button on a case view: revoke it (opens a modal). */
  revokeCase: 'case-revoke',
  revokeSubmit: 'revoke-submit',
  /** Button on a case view: the member's full history. */
  memberHistory: 'history',
  /** Kick / ban confirmation buttons (pending token). */
  confirm: 'confirm',
  cancel: 'cancel',
  /** Modal: Delete & warn (pending token). */
  deleteWarnSubmit: 'dw-submit',
  /** Modal: raid mode reason. */
  raidModeSubmit: 'raid-submit',
} as const;

export type ModActionId = (typeof MOD_ACTIONS)[keyof typeof MOD_ACTIONS];

export function modId(action: ModActionId, ...args: (string | number)[]): string {
  return customId(MOD_NS, action, ...args);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNOWFLAKE = /^\d{17,20}$/;
const TOKEN = /^[A-Za-z0-9_-]{8,32}$/;

/** Custom-id arguments are untrusted: validate their shape before use. */
export function uuidArg(value: string | undefined): string | null {
  return value && UUID.test(value) ? value : null;
}

export function snowflakeArg(value: string | undefined): string | null {
  return value && SNOWFLAKE.test(value) ? value : null;
}

export function tokenArg(value: string | undefined): string | null {
  return value && TOKEN.test(value) ? value : null;
}

export function isSnowflake(value: string | null | undefined): value is string {
  return Boolean(value && SNOWFLAKE.test(value));
}
