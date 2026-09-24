'use client';

import { Input, NativeSelect, Switch, Textarea } from '@jave/ui';
import { VISIBILITY_LABELS, optionsFrom } from '@/lib/member-labels';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

export interface ProfileFormValues {
  displayName: string;
  handle: string;
  headline: string;
  bio: string;
  primaryDomain: string;
  profileVisibility: keyof typeof VISIBILITY_LABELS;
  showClaimsPublicly: boolean;
  showOnLeaderboards: boolean;
}

export function ProfileForm({
  values,
  domains,
  action,
}: {
  values: ProfileFormValues;
  domains: readonly { value: string; label: string }[];
  action: FormAction;
}) {
  return (
    <ActionForm action={action} submitLabel="Save profile" aria-label="Profile">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField name="displayName" label="Display name" required>
          <Input name="displayName" defaultValue={values.displayName} required maxLength={64} />
        </FormField>
        <FormField
          name="handle"
          label="Handle"
          description="Your public URL: /p/handle. 2–32 of a–z, 0–9, - or _."
        >
          <Input
            name="handle"
            defaultValue={values.handle}
            required
            maxLength={32}
            mono
            autoCapitalize="none"
            spellCheck={false}
          />
        </FormField>
      </div>
      <FormField
        name="headline"
        label="Headline"
        description="One line. What you build, research or train for."
      >
        <Input name="headline" defaultValue={values.headline} maxLength={160} />
      </FormField>
      <FormField name="bio" label="Bio">
        <Textarea name="bio" defaultValue={values.bio} maxLength={2000} rows={5} />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField name="primaryDomain" label="Primary domain">
          <NativeSelect
            name="primaryDomain"
            defaultValue={values.primaryDomain}
            placeholder="None"
            options={domains}
          />
        </FormField>
        <FormField
          name="profileVisibility"
          label="Profile visibility"
          description="Who can open your profile."
        >
          <NativeSelect
            name="profileVisibility"
            defaultValue={values.profileVisibility}
            options={optionsFrom(VISIBILITY_LABELS)}
          />
        </FormField>
      </div>
      <div className="space-y-4 rounded-md border border-line-subtle bg-surface-sunken p-4">
        <Switch
          id="showClaimsPublicly"
          name="showClaimsPublicly"
          defaultChecked={values.showClaimsPublicly}
          label="Show my claims"
          description="Others see your CLAIMED ranks, always labelled as claims. Staff always see them."
        />
        <Switch
          id="showOnLeaderboards"
          name="showOnLeaderboards"
          defaultChecked={values.showOnLeaderboards}
          label="Appear on ranking boards"
          description="Boards list VERIFIED ranks only."
        />
      </div>
    </ActionForm>
  );
}
