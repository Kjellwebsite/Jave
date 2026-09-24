import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { isJaveError, newErrorId, type ServiceContext, ValidationError } from '@jave/core';
import { type ActionState, issuesToFieldErrors } from '@/lib/action-state';
import { baseContext, getRequestContext, isUserContext, type UserContext } from './context';
import { isTrustedMutationRequest } from './request';

function errorState(
  message: string,
  extra: { fieldErrors?: Record<string, string>; reference?: string } = {},
): ActionState {
  return { status: 'error', message, ...extra, at: Date.now() };
}

/**
 * Converts a thrown error into form feedback. Domain errors carry a
 * user-safe message; anything else is logged with its stack under a fresh
 * reference and the user sees only that reference.
 */
export function actionErrorState(
  error: unknown,
  ctx: ServiceContext,
  action: string,
  fieldNames: readonly string[] = [],
): ActionState {
  if (isJaveError(error)) {
    const fieldErrors =
      error instanceof ValidationError ? issuesToFieldErrors(error.issues, fieldNames) : undefined;
    return errorState(error.userMessage, { fieldErrors });
  }
  const reference = newErrorId();
  ctx.logger.error({ err: error, reference, action }, 'server action failed');
  return errorState('The action did not complete. If it keeps failing, report the reference.', {
    reference,
  });
}

export interface ActionOptions {
  /** Field names used to map validation issues onto inline errors. */
  fieldNames?: readonly string[];
}

/**
 * The envelope for every authenticated Server Action: same-origin check,
 * a live session, then the work. Authorization happens inside the core
 * services the work calls — never here, never in the UI.
 */
export async function runAction(
  action: string,
  work: (ctx: UserContext) => Promise<string>,
  options: ActionOptions = {},
): Promise<ActionState> {
  if (!(await isTrustedMutationRequest())) {
    return errorState('Request origin rejected.');
  }
  let ctx: ServiceContext = baseContext();
  try {
    const request = await getRequestContext();
    ctx = request.ctx;
    if (!isUserContext(ctx)) return errorState('Your session has ended. Sign in again.');
    const message = await work(ctx);
    return { status: 'success', message, at: Date.now() };
  } catch (error) {
    unstable_rethrow(error);
    return actionErrorState(error, ctx, action, options.fieldNames);
  }
}
