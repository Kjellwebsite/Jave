/** What every Server Action returns to its form. Serializable; never contains internals. */
export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string; at: number }
  | {
      status: 'error';
      message: string;
      /** Field name → message, for inline errors. */
      fieldErrors?: Record<string, string>;
      /** Error reference (E-XXXXXXXX) for unexpected failures; matches the server log. */
      reference?: string;
      at: number;
    };

export const IDLE_STATE: ActionState = { status: 'idle' };

export type ToastTone = 'success' | 'danger';

export interface ToastInput {
  text: string;
  /** Defaults to `success`. */
  tone?: ToastTone;
  /** Error reference (E-XXXXXXXX) shown with a failure. */
  reference?: string;
}

/** The toast announcing an action result: success or failure, never a failure dressed as success. */
export function actionToast(state: ActionState): ToastInput | null {
  if (state.status === 'idle') return null;
  if (state.status === 'success') return { text: state.message, tone: 'success' };
  return { text: state.message, tone: 'danger', reference: state.reference };
}

/** Maps validation issue paths (e.g. `spam.maxMessages`, `links.allowlist.2`) onto field names. */
export function issuesToFieldErrors(
  issues: readonly { path: string; message: string }[],
  fieldNames: readonly string[] = [],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field =
      fieldNames.find((name) => issue.path === name || issue.path.startsWith(`${name}.`)) ??
      issue.path;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}
