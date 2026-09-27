'use client';

import {
  type FormEvent,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Send } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Fieldset,
  Input,
  NativeSelect,
  Textarea,
} from '@jave/ui';
import { type ActionState, IDLE_STATE } from '@/lib/action-state';
import { DRAFT_INTENT_FIELD, DRAFT_SUBMIT_INTENT } from '@/lib/applications';
import { ActionFeedback, ActionStateProvider, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';
import { useToast } from '../toast';

export interface DraftFormField {
  key: string;
  label: string;
  placeholder: string;
  input: 'select' | 'short' | 'paragraph';
  maxLength: number;
  required: boolean;
}

export interface DraftFormProps {
  fields: readonly DraftFormField[];
  values: Readonly<Record<string, string>>;
  domains: readonly { value: string; label: string }[];
  /** `save` stores the draft; `submit` stores what the form holds, then submits it. */
  actions: { save: FormAction; submit: FormAction };
  /** The application number, named in the submit confirmation. */
  number: string;
  /** False while a cooldown or paused applications block submission: no Submit is offered. */
  canSubmit: boolean;
}

const PARAGRAPH_ROWS = 5;
const SHORT_PARAGRAPH_ROWS = 3;
const SHORT_PARAGRAPH_CHARS = 1000;

/** Fields grouped as the applicant thinks about them; keys come from APPLICATION_FORM_FIELDS. */
const GROUPS = [
  { legend: null, description: null, keys: ['domainKey', 'motivation', 'experience'] },
  {
    legend: 'Proof of work',
    description: 'Projects, a portfolio or evidence links. One is enough; more is better.',
    keys: ['projects', 'portfolioUrl', 'evidenceLinks'],
  },
  {
    legend: 'Staff only',
    description: 'Only staff with application access read these. Never posted in Discord.',
    keys: ['references', 'referralCode'],
  },
] as const;

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  evidenceLinks: 'http(s) only, one per line, up to 10.',
};

/** What Field passes to its control: the label target, help text and error state. */
interface FieldWiring {
  id?: string;
  'aria-describedby'?: string;
  invalid?: boolean;
}

/**
 * One input for one form field. Forwards Field's wiring to the real control,
 * so the label, description and inline error attach to it.
 */
function Control({
  field,
  value,
  domains,
  ...wiring
}: {
  field: DraftFormField;
  value: string;
  domains: DraftFormProps['domains'];
} & FieldWiring) {
  if (field.input === 'select') {
    return (
      <NativeSelect
        {...wiring}
        name={field.key}
        defaultValue={value}
        placeholder="Choose a domain"
        options={domains}
      />
    );
  }
  if (field.input === 'paragraph') {
    return (
      <Textarea
        {...wiring}
        name={field.key}
        maxLength={field.maxLength}
        rows={field.maxLength > SHORT_PARAGRAPH_CHARS ? PARAGRAPH_ROWS : SHORT_PARAGRAPH_ROWS}
        placeholder={field.placeholder}
        defaultValue={value}
      />
    );
  }
  const url = field.key === 'portfolioUrl';
  return (
    <Input
      {...wiring}
      name={field.key}
      type={url ? 'url' : 'text'}
      inputMode={url ? 'url' : undefined}
      maxLength={field.maxLength}
      placeholder={field.placeholder}
      defaultValue={value}
      mono={field.key === 'referralCode'}
    />
  );
}

function DraftFields({
  fields,
  values,
  domains,
}: Pick<DraftFormProps, 'fields' | 'values' | 'domains'>) {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  return GROUPS.map((group) => {
    const controls = group.keys.flatMap((key) => {
      const field = byKey.get(key);
      if (!field) return [];
      return [
        <FormField
          key={field.key}
          name={field.key}
          label={field.label.replace(' (staff only)', '')}
          description={DESCRIPTIONS[field.key]}
          required={field.required}
        >
          <Control field={field} value={values[field.key] ?? ''} domains={domains} />
        </FormField>,
      ];
    });
    if (!group.legend)
      return (
        <div key="about" className="space-y-5">
          {controls}
        </div>
      );
    // The divider sits on a wrapper: on a <fieldset> border the legend would cut into it.
    return (
      <div key={group.legend} className="border-t border-line-subtle pt-6">
        <Fieldset
          legend={<span className="type-eyebrow text-fg-subtle">{group.legend}</span>}
          description={group.description}
          className="space-y-5"
        >
          {controls}
        </Fieldset>
      </div>
    );
  });
}

/**
 * The application form: every APPLICATION_FORM_FIELDS entry with the
 * service's own caps. Saving keeps it a private draft. Submitting sends what
 * the form holds, saved first, so an edit is never left behind or lost when
 * the answers lock. The service resolves the caller's own draft, so the form
 * carries no application id.
 */
export function DraftForm({ fields, values, domains, actions, number, canSubmit }: DraftFormProps) {
  const toast = useToast();
  // A successful submit replaces this form with the read-only view, so its
  // result is announced from the call itself, not from this (unmounting) form.
  const run = useCallback(
    async (previous: ActionState, data: FormData): Promise<ActionState> => {
      const submitting = data.get(DRAFT_INTENT_FIELD) === DRAFT_SUBMIT_INTENT;
      const next = await (submitting ? actions.submit : actions.save)(previous, data);
      if (submitting && next.status === 'success') toast({ text: next.message, tone: 'success' });
      return next;
    },
    [actions, toast],
  );
  const [state, dispatch, pending] = useActionState(run, IDLE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  // The confirmation closes once its submit finishes; a refusal shows in the form.
  useEffect(() => {
    if (!pending) setConfirming(false);
  }, [pending]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  }

  function submit() {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set(DRAFT_INTENT_FIELD, DRAFT_SUBMIT_INTENT);
    startTransition(() => dispatch(data));
  }

  return (
    <ActionStateProvider value={state}>
      <form
        ref={formRef}
        action={dispatch}
        onSubmit={save}
        aria-label="Application draft"
        aria-busy={pending || undefined}
        className="space-y-5"
      >
        <fieldset disabled={pending} className="min-w-0 space-y-5">
          <DraftFields fields={fields} values={values} domains={domains} />
        </fieldset>
        <ActionFeedback state={state} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="submit" variant="secondary" loading={pending && !confirming}>
            Save draft
          </Button>
          {canSubmit ? (
            <Dialog
              open={confirming}
              onOpenChange={(next) => {
                if (!pending) setConfirming(next);
              }}
            >
              <DialogTrigger asChild>
                <Button variant="primary" iconLeft={Send} disabled={pending}>
                  Submit application
                </Button>
              </DialogTrigger>
              <DialogContent
                size="sm"
                eyebrow={number}
                title="Submit application"
                description="The answers in the form are saved, then sent to the review team, and they lock. You are told when a reviewer picks it up and when there is a decision. Withdrawing later starts a cooldown."
                footer={
                  <>
                    <DialogClose asChild>
                      <Button variant="ghost" disabled={pending}>
                        Cancel
                      </Button>
                    </DialogClose>
                    <Button variant="primary" loading={pending} onClick={submit}>
                      Submit application
                    </Button>
                  </>
                }
              />
            </Dialog>
          ) : null}
        </div>
      </form>
    </ActionStateProvider>
  );
}
