'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTrigger,
  Input,
  NativeSelect,
  Textarea,
} from '@jave/ui';
import {
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  optionsOf,
  PRIORITY_LABELS,
  type TicketCategory,
} from '@/lib/ticket-view';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

/** Mirrors core's limits so the browser stops obvious mistakes before a round trip. */
const SUBJECT_MIN = 3;
const SUBJECT_MAX = 120;
const BODY_MIN = 3;
const BODY_MAX = 4000;
const BODY_ROWS = 6;

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as TicketCategory[]).map((value) => ({
  value,
  label: `${CATEGORY_LABELS[value]} — ${CATEGORY_HINTS[value]}`,
}));

/**
 * Open a ticket from the dashboard. Same service as Discord's /ticket open:
 * the bot provisions the private thread; the ticket page opens on success.
 */
export function OpenTicketDialog({ action }: { action: FormAction }) {
  const [session, setSession] = useState(0);
  return (
    <Dialog onOpenChange={(open) => (open ? setSession((count) => count + 1) : undefined)}>
      <DialogTrigger asChild>
        <Button variant="secondary" iconLeft={Plus} data-testid="open-ticket">
          Open a ticket
        </Button>
      </DialogTrigger>
      <DialogContent
        size="lg"
        eyebrow="SUPPORT"
        title="Open a ticket"
        description="A private thread opens in Discord with you and JAVELIN staff. Nobody else can read it."
      >
        <ActionForm key={session} action={action} submitLabel="Open ticket">
          <FormField name="category" label="Category" required>
            <NativeSelect
              name="category"
              required
              defaultValue="general"
              options={CATEGORY_OPTIONS}
            />
          </FormField>
          <FormField
            name="priority"
            label="Priority"
            description="HIGH and URGENT alert every handler. Keep URGENT for safety or access emergencies."
          >
            <NativeSelect
              name="priority"
              defaultValue="normal"
              options={optionsOf(PRIORITY_LABELS)}
            />
          </FormField>
          <FormField
            name="subject"
            label="Subject"
            description="One line. What do you need?"
            required
          >
            <Input name="subject" required minLength={SUBJECT_MIN} maxLength={SUBJECT_MAX} />
          </FormField>
          <FormField
            name="body"
            label="Details"
            description="Context, what you tried, links. Staff read this first."
            required
          >
            <Textarea
              name="body"
              required
              minLength={BODY_MIN}
              maxLength={BODY_MAX}
              rows={BODY_ROWS}
            />
          </FormField>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
