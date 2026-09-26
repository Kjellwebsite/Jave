'use client';

import { Input, NativeSelect, Textarea } from '@jave/ui';
import { EVENT_KIND_LABELS, EVENT_KINDS } from '@/lib/event-labels';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

/** Form defaults. Times are datetime-local values in the viewer's time zone. */
export interface EventFormValues {
  title: string;
  kind: string;
  description: string;
  startsAt: string;
  endsAt: string;
  location: string;
  capacity: string;
  rsvpClosesAt: string;
}

export const EMPTY_EVENT_FORM: EventFormValues = {
  title: '',
  kind: 'meetup',
  description: '',
  startsAt: '',
  endsAt: '',
  location: '',
  capacity: '',
  rsvpClosesAt: '',
};

/** Core's input limits, passed from the server (core never enters the client bundle). */
export interface EventFormLimits {
  titleMin: number;
  titleMax: number;
  descriptionMax: number;
  locationMax: number;
  capacityMax: number;
}

export interface EventFormProps {
  action: FormAction;
  limits: EventFormLimits;
  values: EventFormValues;
  submitLabel: string;
  timeZone: string;
  /** Edit mode: the event being edited (sent as a hidden field). */
  eventId?: string;
  /** Kind cannot change once a tournament has a bracket. */
  kindLocked?: boolean;
}

const KIND_OPTIONS = EVENT_KINDS.map((kind) => ({ value: kind, label: EVENT_KIND_LABELS[kind] }));

export function EventForm({
  action,
  limits,
  values,
  submitLabel,
  timeZone,
  eventId,
  kindLocked = false,
}: EventFormProps) {
  const editing = eventId !== undefined;
  return (
    <ActionForm action={action} submitLabel={submitLabel} aria-label="Event">
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px]">
        <FormField name="title" label="Title" required>
          <Input
            name="title"
            defaultValue={values.title}
            required
            minLength={limits.titleMin}
            maxLength={limits.titleMax}
          />
        </FormField>
        <FormField
          name="kind"
          label="Kind"
          description={kindLocked ? 'Locked: the bracket exists.' : undefined}
        >
          {kindLocked ? (
            <NativeSelect
              name="kind"
              defaultValue={values.kind}
              options={KIND_OPTIONS.filter((option) => option.value === values.kind)}
            />
          ) : (
            <NativeSelect name="kind" defaultValue={values.kind} options={KIND_OPTIONS} />
          )}
        </FormField>
      </div>
      <FormField
        name="description"
        label="Description"
        description="Plain text. Shown on the Discord announcement and the event page."
      >
        <Textarea
          name="description"
          defaultValue={values.description}
          maxLength={limits.descriptionMax}
          rows={4}
        />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          name="startsAt"
          label="Start"
          description={`Your time zone: ${timeZone}.`}
          required
        >
          <Input name="startsAt" type="datetime-local" defaultValue={values.startsAt} required />
        </FormField>
        <FormField
          name="endsAt"
          label="End"
          description={editing ? 'Leave blank to keep the duration.' : 'Leave blank for two hours.'}
        >
          <Input name="endsAt" type="datetime-local" defaultValue={values.endsAt} />
        </FormField>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          name="location"
          label="Location"
          description="A voice channel ID, an https:// link, or a place."
        >
          <Input name="location" defaultValue={values.location} maxLength={limits.locationMax} />
        </FormField>
        <FormField
          name="capacity"
          label="Capacity"
          description="Beyond it, members join a waitlist. Blank: no limit."
        >
          <Input
            name="capacity"
            type="number"
            inputMode="numeric"
            min={1}
            max={limits.capacityMax}
            step={1}
            defaultValue={values.capacity}
            mono
          />
        </FormField>
      </div>
      <FormField
        name="rsvpClosesAt"
        label="RSVP closes"
        description="Optional. Going and maybe close then; declining stays open until the end."
        className="sm:max-w-[calc(50%-10px)]"
      >
        <Input name="rsvpClosesAt" type="datetime-local" defaultValue={values.rsvpClosesAt} />
      </FormField>
    </ActionForm>
  );
}
