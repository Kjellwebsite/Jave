import type { ActionState } from './action-state';

/**
 * The result of issuing a check-in code: the usual action state, plus — on
 * success only — the plaintext code and its window, pre-formatted in the
 * viewer's time zone. It lives only in the issuing browser's memory.
 */
export type CheckInCodeState =
  | ActionState
  | (Extract<ActionState, { status: 'success' }> & {
      code: string;
      opensAt: string;
      closesAt: string;
    });

export function hasIssuedCode(
  state: CheckInCodeState,
): state is Extract<CheckInCodeState, { code: string }> {
  return state.status === 'success' && 'code' in state;
}
