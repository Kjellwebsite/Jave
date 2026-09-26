'use client';

import { Input, NativeSelect, Textarea } from '@jave/ui';
import {
  EVIDENCE_LABELS,
  type EvidenceLevel,
  RESEARCH_STATUS_LABELS,
  REVIEW_STATUSES,
  type ReviewStatus,
} from '@/lib/research-labels';
import { ActionForm, type FormAction } from '../forms/action-form';
import { FormField } from '../forms/form-field';

/** Core's field limits (research/constants.ts). */
const LIMITS = { topic: 80, tags: 400, summary: 4000, note: 1000 };

export interface ReviewFormProps {
  action: FormAction;
  itemId: string;
  /** The version on screen: the decision applies to exactly this version. */
  version: number;
  archived: boolean;
  current: {
    status: ReviewStatus | null;
    evidenceLevel: EvidenceLevel;
    topic: string | null;
    tags: readonly string[];
    summary: string | null;
  };
}

const EVIDENCE_OPTIONS = (Object.keys(EVIDENCE_LABELS) as EvidenceLevel[]).map((level) => ({
  value: level,
  label: EVIDENCE_LABELS[level],
}));

/** Reviewer decision: status, evidence level, topic, tags, summary and an audited note. */
export function ReviewForm({ action, itemId, version, archived, current }: ReviewFormProps) {
  const statuses = archived ? (['needs_review'] as const) : REVIEW_STATUSES;
  return (
    <ActionForm action={action} submitLabel={archived ? 'Restore for review' : 'Record review'} aria-label="Review">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="expectedVersion" value={String(version)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="status"
          label="Status"
          description={archived ? 'Archived items return to NEEDS REVIEW.' : 'VERIFIED needs a known evidence level.'}
        >
          <NativeSelect
            name="status"
            defaultValue={archived ? 'needs_review' : (current.status ?? '')}
            placeholder={archived ? undefined : 'Keep current status'}
            options={statuses.map((status) => ({
              value: status,
              label: RESEARCH_STATUS_LABELS[status],
            }))}
          />
        </FormField>
        <FormField name="evidenceLevel" label="Evidence level">
          <NativeSelect
            name="evidenceLevel"
            defaultValue={current.evidenceLevel}
            options={EVIDENCE_OPTIONS}
          />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="topic" label="Topic">
          <Input name="topic" maxLength={LIMITS.topic} defaultValue={current.topic ?? ''} autoComplete="off" />
        </FormField>
        <FormField name="tags" label="Tags" description="Comma separated, at most 10.">
          <Input name="tags" maxLength={LIMITS.tags} defaultValue={current.tags.join(', ')} autoComplete="off" />
        </FormField>
      </div>
      <FormField name="summary" label="Summary">
        <Textarea name="summary" maxLength={LIMITS.summary} rows={4} defaultValue={current.summary ?? ''} />
      </FormField>
      <FormField name="note" label="Review note" description="Optional. Recorded in the audit log.">
        <Textarea name="note" maxLength={LIMITS.note} rows={2} />
      </FormField>
    </ActionForm>
  );
}
