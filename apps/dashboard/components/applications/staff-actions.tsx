'use client';

import { CalendarClock, Check, ClipboardCheck, UserRoundCheck, X } from 'lucide-react';
import { Button, Input, NativeSelect, Textarea } from '@jave/ui';
import {
  RECOMMENDATION_LABELS,
  RECOMMENDATIONS,
  REVIEW_SCORES,
  SCORE_LABELS,
} from '@/lib/applications';
import type { FormAction } from '../forms/action-form';
import { ConfirmActionDialog } from '../forms/confirm-action-dialog';
import { FormField } from '../forms/form-field';

/** Browser-side hint only; the service enforces the real minimum. */
const DECISION_REASON_MIN_CHARS = 3;

/** Text caps from core's APPLICATION_FIELD_LIMITS, passed in by the server page. */
export interface ApplicationStaffLimits {
  reviewNote: number;
  decisionReason: number;
  applicantMessage: number;
  interviewNote: number;
}

export interface ApplicationStaffActionsProps {
  applicationId: string;
  number: string;
  /** Controls this viewer can use now (capability and state), computed server-side. */
  can: { claim: boolean; review: boolean; interview: boolean; accept: boolean; reject: boolean };
  myReview: { recommendation: string; score: number | null; note: string | null } | null;
  interview: { current: string | null; timeZone: string };
  consequences: { accept: string; reject: string };
  limits: ApplicationStaffLimits;
  actions: { claim: FormAction; review: FormAction; interview: FormAction; decide: FormAction };
}

export function ApplicationStaffActions({
  applicationId,
  number,
  can,
  myReview,
  interview,
  consequences,
  limits,
  actions,
}: ApplicationStaffActionsProps) {
  const hidden = { applicationId };
  return (
    <div className="flex flex-wrap gap-2" data-testid="application-actions">
      {can.claim ? (
        <ConfirmActionDialog
          eyebrow={number}
          title="Claim for review"
          description="Assigns this application to you. The applicant is told a reviewer is on it."
          confirmLabel="Claim application"
          action={actions.claim}
          hidden={hidden}
          trigger={
            <Button variant="primary" iconLeft={UserRoundCheck}>
              Claim
            </Button>
          }
        />
      ) : null}
      {can.review ? (
        <ConfirmActionDialog
          eyebrow={number}
          title={myReview ? 'Update your review' : 'Review'}
          description="One review per reviewer; submitting again replaces yours. Abstentions do not count toward a decision."
          confirmLabel={myReview ? 'Replace review' : 'Record review'}
          action={actions.review}
          hidden={hidden}
          trigger={
            <Button variant={can.claim ? 'secondary' : 'primary'} iconLeft={ClipboardCheck}>
              {myReview ? 'Update review' : 'Review'}
            </Button>
          }
        >
          <FormField name="recommendation" label="Recommendation" required>
            <NativeSelect
              name="recommendation"
              required
              defaultValue={myReview?.recommendation ?? ''}
              placeholder="Choose"
              options={RECOMMENDATIONS.map((value) => ({
                value,
                label: RECOMMENDATION_LABELS[value],
              }))}
            />
          </FormField>
          <FormField name="score" label="Score" description="1–5. Required unless you abstain.">
            <NativeSelect
              name="score"
              defaultValue={myReview?.score ? String(myReview.score) : ''}
              placeholder="No score — abstain"
              options={REVIEW_SCORES.map((value) => ({ value, label: SCORE_LABELS[value] }))}
            />
          </FormField>
          <FormField name="note" label="Note" description="Staff only.">
            <Textarea
              name="note"
              maxLength={limits.reviewNote}
              rows={4}
              defaultValue={myReview?.note ?? ''}
              placeholder="What the evidence shows, and what it does not."
            />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {can.interview ? (
        <ConfirmActionDialog
          eyebrow={number}
          title={interview.current ? 'Move interview' : 'Schedule interview'}
          description="The applicant is notified now and reminded one hour before."
          confirmLabel={interview.current ? 'Move interview' : 'Schedule interview'}
          action={actions.interview}
          hidden={hidden}
          trigger={
            <Button variant="secondary" iconLeft={CalendarClock}>
              {interview.current ? 'Move interview' : 'Interview'}
            </Button>
          }
        >
          <FormField
            name="interviewAt"
            label="When"
            description={`Your time zone: ${interview.timeZone}. 15 minutes to 90 days ahead.`}
            required
          >
            <Input
              name="interviewAt"
              type="datetime-local"
              required
              defaultValue={interview.current ?? ''}
            />
          </FormField>
          <FormField
            name="applicantMessage"
            label="Message to the applicant"
            description="Optional. Where to join, what to prepare."
          >
            <Textarea name="applicantMessage" maxLength={limits.interviewNote} rows={3} />
          </FormField>
        </ConfirmActionDialog>
      ) : null}
      {can.accept ? (
        <DecisionDialog
          decision="accept"
          number={number}
          consequence={consequences.accept}
          action={actions.decide}
          applicationId={applicationId}
          limits={limits}
        />
      ) : null}
      {can.reject ? (
        <DecisionDialog
          decision="reject"
          number={number}
          consequence={consequences.reject}
          action={actions.decide}
          applicationId={applicationId}
          limits={limits}
        />
      ) : null}
    </div>
  );
}

function DecisionDialog({
  decision,
  number,
  consequence,
  action,
  applicationId,
  limits,
}: {
  decision: 'accept' | 'reject';
  number: string;
  consequence: string;
  action: FormAction;
  applicationId: string;
  limits: ApplicationStaffLimits;
}) {
  const accept = decision === 'accept';
  return (
    <ConfirmActionDialog
      eyebrow={number}
      title={accept ? `Accept ${number}` : `Reject ${number}`}
      description={consequence}
      confirmLabel={accept ? 'Accept application' : 'Reject application'}
      tone={accept ? 'default' : 'danger'}
      action={action}
      hidden={{ applicationId, decision }}
      trigger={
        <Button variant="secondary" iconLeft={accept ? Check : X}>
          {accept ? 'Accept' : 'Reject'}
        </Button>
      }
    >
      <FormField
        name="reason"
        label="Internal reason"
        description="Staff only. Recorded in the audit log; never shown to the applicant."
        required
      >
        <Textarea
          name="reason"
          required
          minLength={DECISION_REASON_MIN_CHARS}
          maxLength={limits.decisionReason}
          rows={3}
        />
      </FormField>
      <FormField
        name="applicantMessage"
        label="Message to the applicant"
        description="Optional. Delivered with the outcome."
      >
        <Textarea name="applicantMessage" maxLength={limits.applicantMessage} rows={3} />
      </FormField>
    </ConfirmActionDialog>
  );
}
