import type { ReactNode } from 'react';
import { ClipboardCheck, Eye, OctagonX, Play, Plus, Send, ShieldCheck, Square } from 'lucide-react';
import { adversarial } from '@jave/core';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Mono,
  StatusBadge,
  Textarea,
  Timeline,
  type TimelineItem,
} from '@jave/ui';
import {
  OBSERVATION_TONE,
  type ObservationOutcomeKey,
  ROLE_STATUS_LABELS,
  ROLE_STATUS_TONE,
} from '@/lib/trial-labels';
import { formatTimestamp } from '@/lib/time';
import type { FormAction } from '../../forms/action-form';
import { ConfirmActionDialog } from '../../forms/confirm-action-dialog';
import { FormField } from '../../forms/form-field';
import { SelectField } from '../../forms/select-field';
import { type TriggerActions, TriggerList } from './trigger-list';

export interface RoleActions extends TriggerActions {
  authorize: FormAction;
  brief: FormAction;
  activate: FormAction;
  conclude: FormAction;
  abort: FormAction;
  addTrigger: FormAction;
  observe: FormAction;
  evaluate: FormAction;
  reveal: FormAction;
}

export interface RoleCardProps {
  trialId: string;
  role: adversarial.RoleDetail;
  /** Participant names by member id (observation subjects). */
  names: ReadonlyMap<string, string>;
  /** Members of the role's team, for attributing an observation (staff-only). */
  subjects: readonly { memberId: string; displayName: string }[];
  /** The trial has ended (evaluating, completed or cancelled): reveals are possible. */
  trialOver: boolean;
  viewerUserId: string;
  canAuthorize: boolean;
  outcomeLabels: Readonly<Record<ObservationOutcomeKey, string>>;
  techniqueLabel: string;
  timeZone: string;
  actions: RoleActions;
}

const TEXT = { label: 120, prose: 1000, observation: 2000, summary: 2000, debrief: 3000 } as const;
const SCORE_MAX = 10;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1 text-small text-fg-muted">{children}</dd>
    </div>
  );
}

function deliveryLabel(value: string | null): string {
  return value ? value.toUpperCase() : '—';
}

/**
 * One adversarial role: its state, the two-person authorization, triggers,
 * observations and evaluation — with the controls its state allows. Every
 * control is checked again by the adversarial service.
 */
export function RoleCard({
  trialId,
  role,
  names,
  subjects,
  trialOver,
  viewerUserId,
  canAuthorize,
  outcomeLabels,
  techniqueLabel,
  timeZone,
  actions,
}: RoleCardProps) {
  const record = role.role;
  const hidden = { trialId, roleId: role.id };
  const planner = record.createdByUserId === viewerUserId;
  // The authorizer must not have written any trigger of the plan they sign.
  const wroteTrigger = role.triggers.some((trigger) => trigger.createdByUserId === viewerUserId);
  const triggersEditable = adversarial.TRIGGER_EDITABLE_STATUSES.includes(record.status);
  const triggerLabel = new Map(role.triggers.map((trigger) => [trigger.id, trigger.label]));
  const awaitingReveal = adversarial.isAwaitingReveal(record);
  const observing = adversarial.acceptsObservations(record);
  const abortable = adversarial.ABORTABLE_STATUSES.includes(record.status);

  const timeline: TimelineItem[] = role.observations.map((observation) => ({
    id: observation.id,
    at: observation.occurredAt,
    atLabel: formatTimestamp(observation.occurredAt, timeZone),
    tone: OBSERVATION_TONE[observation.outcome],
    title: (
      <span className="flex flex-wrap items-center gap-2">
        <span className="type-eyebrow">{outcomeLabels[observation.outcome].toUpperCase()}</span>
        {observation.subjectMemberId ? (
          <Mono dim className="text-[12px]">
            {names.get(observation.subjectMemberId) ?? 'participant'}
          </Mono>
        ) : null}
      </span>
    ),
    description: <span className="whitespace-pre-wrap break-words">{observation.description}</span>,
    meta: observation.triggerId
      ? `Trigger: ${triggerLabel.get(observation.triggerId) ?? '—'}`
      : undefined,
  }));

  return (
    <Card
      as="article"
      padding="none"
      data-role={record.status}
      aria-label={`Role on ${role.team?.name ?? 'team'}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0 space-y-1">
          <p className="type-eyebrow text-fg-subtle">
            {role.team?.name ?? 'TEAM REMOVED'} · {techniqueLabel.toUpperCase()}
          </p>
          <h3 className="type-heading text-fg">{role.scenario.title}</h3>
          <p className="text-small text-fg-subtle">
            Operative {role.operative.displayName} <Mono dim>@{role.operative.handle}</Mono>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={ROLE_STATUS_TONE[record.status]}
            label={ROLE_STATUS_LABELS[record.status].toUpperCase()}
            live={record.status === 'active'}
          />
          {role.authorized ? (
            <Badge tone="success">Two-person OK</Badge>
          ) : (
            <Badge tone="warning">Awaiting 2nd person</Badge>
          )}
          {record.redFlagRaisedAt ? <Badge tone="danger">RED FLAG</Badge> : null}
        </div>
      </header>

      <div className="space-y-5 px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Fact label="PLAN">
            rev {record.planRevision} · {role.authorized ? 'signed' : 'under review'}
          </Fact>
          <Fact label="BRIEFING">
            {record.briefedAt
              ? `rev ${record.briefingRevision} · ${deliveryLabel(record.briefingDelivery)}`
              : 'Not sent'}
          </Fact>
          <Fact label="STOP NOTICE">{deliveryLabel(record.stopNoticeDelivery)}</Fact>
          <Fact label="DEBRIEF">{deliveryLabel(record.debriefDelivery)}</Fact>
          <Fact label="SUGGESTED">
            {role.suggestedScore === null ? 'no observations' : `${role.suggestedScore}/10`}
          </Fact>
        </dl>

        <div>
          <p className="type-eyebrow text-fg-subtle">OBJECTIVE</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-small text-fg-muted">
            {record.objective}
          </p>
        </div>

        {record.abortReason ? (
          <p className="text-small text-danger">Stopped: {record.abortReason}</p>
        ) : null}

        <div>
          <p className="type-eyebrow text-fg-subtle">TRIGGERS</p>
          <TriggerList
            trialId={trialId}
            roleId={role.id}
            triggers={role.triggers}
            editable={triggersEditable}
            roleAuthorized={role.authorized}
            exerciseActive={record.status === 'active'}
            viewerUserId={viewerUserId}
            canAuthorize={canAuthorize}
            timeZone={timeZone}
            actions={actions}
          />
        </div>

        <div>
          <p className="type-eyebrow text-fg-subtle">OBSERVATIONS</p>
          {timeline.length === 0 ? (
            <p className="mt-1 text-small text-fg-subtle">None recorded.</p>
          ) : (
            <Timeline items={timeline} label="Observations" className="mt-3" />
          )}
        </div>

        {role.evaluation ? (
          <div className="rounded-md border border-line p-4">
            <p className="type-eyebrow text-fg-subtle">EVALUATION</p>
            <p className="mt-1 text-small text-fg-muted">
              Security culture{' '}
              <Mono className="text-fg">{role.evaluation.securityCultureScore}/10</Mono>
              {role.evaluation.overrideJustification
                ? ` — override: ${role.evaluation.overrideJustification}`
                : ''}
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-small text-fg-muted">
              {role.evaluation.summary}
            </p>
            {role.evaluation.debrief ? (
              <p className="mt-2 whitespace-pre-wrap break-words text-small text-fg-subtle">
                Debrief: {role.evaluation.debrief}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line-subtle px-5 py-3">
        {record.status === 'planned' && !role.authorized && canAuthorize ? (
          planner || wroteTrigger ? (
            <span className="text-small text-fg-subtle">
              {planner
                ? 'You planned this role: a different authorizer must approve it.'
                : 'You wrote a trigger in this plan: a different authorizer must approve it.'}
            </span>
          ) : (
            <ConfirmActionDialog
              eyebrow="TWO-PERSON RULE"
              title="Authorize role"
              description={`You are the second person. You sign plan revision ${record.planRevision}: everything the operative will see — objective, guardrails, assets, ${role.triggers.length} trigger(s) — is checked again now. A plan changed since you loaded it is refused.`}
              confirmLabel="Authorize"
              action={actions.authorize}
              hidden={{ ...hidden, planRevision: String(record.planRevision) }}
              trigger={
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={ShieldCheck}
                  data-testid="authorize-role"
                >
                  Authorize
                </Button>
              }
            >
              <Checkbox
                id={`attest-${role.id}`}
                name="sandboxAttested"
                label="I attest: fictional data and sandbox accounts only"
                description="No real credentials, personal data, outside people or external systems."
              />
              <FormField
                name="note"
                label="Note"
                description="Optional. Recorded in the audit log."
              >
                <Textarea name="note" maxLength={500} rows={2} />
              </FormField>
            </ConfirmActionDialog>
          )
        ) : null}

        {record.status === 'planned' && role.authorized ? (
          <ConfirmActionDialog
            eyebrow="ADVERSARIAL"
            title="Brief operative"
            description="The operative receives the confidential briefing by DM, with guardrails and the RED FLAG stop word."
            confirmLabel="Brief operative"
            action={actions.brief}
            hidden={hidden}
            trigger={
              <Button variant="primary" size="sm" iconLeft={Send}>
                Brief
              </Button>
            }
          />
        ) : null}

        {record.status === 'briefed' ? (
          <ConfirmActionDialog
            eyebrow="ADVERSARIAL"
            title="Activate exercise"
            description="The operative may act within the objective and triggers. Only while the trial is live and before its deadline."
            confirmLabel="Activate"
            action={actions.activate}
            hidden={hidden}
            trigger={
              <Button variant="primary" size="sm" iconLeft={Play}>
                Activate
              </Button>
            }
          />
        ) : null}

        {record.status === 'active' ? (
          <ConfirmActionDialog
            eyebrow="ADVERSARIAL"
            title="Conclude exercise"
            description="The operative stands down. Observations stay open until the reveal."
            confirmLabel="Conclude"
            action={actions.conclude}
            hidden={hidden}
            trigger={
              <Button size="sm" iconLeft={Square}>
                Conclude
              </Button>
            }
          />
        ) : null}

        {triggersEditable ? (
          <ConfirmActionDialog
            eyebrow="ADVERSARIAL"
            title="Add trigger"
            description={
              role.authorized
                ? 'A planned beat for the operative. It stays pending — invisible to the operative — until an authorizer other than you approves it.'
                : 'A planned beat for the operative. It becomes part of the plan under review; the authorizer approves it with the role.'
            }
            confirmLabel="Add trigger"
            action={actions.addTrigger}
            hidden={hidden}
            trigger={
              <Button size="sm" variant="ghost" iconLeft={Plus} data-testid="add-trigger">
                Add trigger
              </Button>
            }
          >
            <FormField name="label" label="Label" required>
              <Input name="label" required minLength={3} maxLength={TEXT.label} />
            </FormField>
            <FormField name="description" label="What the operative does" required>
              <Textarea
                name="description"
                required
                minLength={10}
                maxLength={TEXT.prose}
                rows={3}
              />
            </FormField>
            <FormField name="plannedFor" label="Planned for" description={`Optional. ${timeZone}.`}>
              <Input name="plannedFor" type="datetime-local" mono />
            </FormField>
          </ConfirmActionDialog>
        ) : null}

        {observing ? (
          <ConfirmActionDialog
            eyebrow="ADVERSARIAL"
            title="Record observation"
            description="How the team responded. Aggregated in the debrief; individual names never reach the team channel."
            confirmLabel="Record"
            action={actions.observe}
            hidden={hidden}
            trigger={
              <Button size="sm" variant="ghost" iconLeft={Eye} data-testid="record-observation">
                Observe
              </Button>
            }
          >
            <SelectField
              name="outcome"
              label="Outcome"
              required
              defaultValue="reported"
              options={(Object.keys(outcomeLabels) as ObservationOutcomeKey[]).map((key) => ({
                value: key,
                label: outcomeLabels[key],
              }))}
            />
            {role.triggers.length > 0 ? (
              <SelectField
                name="triggerId"
                label="Trigger"
                defaultValue=""
                placeholder="Not tied to a trigger"
                options={role.triggers.map((trigger) => ({
                  value: trigger.id,
                  label: trigger.label,
                }))}
              />
            ) : null}
            {subjects.length > 0 ? (
              <SelectField
                name="subjectMemberId"
                label="Participant"
                description="Optional. Staff-only; the team debrief never names anyone."
                defaultValue=""
                placeholder="The team as a whole"
                options={subjects.map((subject) => ({
                  value: subject.memberId,
                  label: subject.displayName,
                }))}
              />
            ) : null}
            <FormField name="description" label="What happened" required>
              <Textarea
                name="description"
                required
                minLength={10}
                maxLength={TEXT.observation}
                rows={4}
              />
            </FormField>
          </ConfirmActionDialog>
        ) : null}

        {awaitingReveal ? (
          <ConfirmActionDialog
            eyebrow="ADVERSARIAL"
            title="Evaluate security culture"
            description={
              role.suggestedScore === null
                ? 'No observations: set a score and justify it. UNKNOWN is not a score.'
                : `Suggested ${role.suggestedScore}/10 from the observations. A different score needs a justification.`
            }
            confirmLabel="Save evaluation"
            action={actions.evaluate}
            hidden={hidden}
            trigger={
              <Button size="sm" iconLeft={ClipboardCheck} data-testid="evaluate-role">
                Evaluate
              </Button>
            }
          >
            <FormField
              name="score"
              label="Score (0–10)"
              description="Leave empty to accept the suggestion."
            >
              <Input
                name="score"
                type="number"
                inputMode="numeric"
                min={0}
                max={SCORE_MAX}
                defaultValue={role.evaluation?.securityCultureScore ?? ''}
                mono
              />
            </FormField>
            <FormField name="justification" label="Justification">
              <Textarea
                name="justification"
                maxLength={TEXT.prose}
                rows={2}
                defaultValue={role.evaluation?.overrideJustification ?? ''}
              />
            </FormField>
            <FormField name="summary" label="Staff summary" required>
              <Textarea
                name="summary"
                required
                minLength={10}
                maxLength={TEXT.summary}
                rows={3}
                defaultValue={role.evaluation?.summary ?? ''}
              />
            </FormField>
            <FormField
              name="debrief"
              label="Team debrief"
              description="Shared with the team at the reveal. Never name individual participants."
            >
              <Textarea
                name="debrief"
                maxLength={TEXT.debrief}
                rows={4}
                defaultValue={role.evaluation?.debrief ?? ''}
              />
            </FormField>
          </ConfirmActionDialog>
        ) : null}

        {awaitingReveal && role.evaluation?.debrief && trialOver ? (
          <ConfirmActionDialog
            eyebrow="ADVERSARIAL"
            title="Reveal to the team"
            description="Participants receive the debrief, and it is posted in the team channel. Revealing is final."
            confirmLabel="Reveal"
            action={actions.reveal}
            hidden={hidden}
            trigger={
              <Button size="sm" variant="primary" data-testid="reveal-role">
                Reveal
              </Button>
            }
          />
        ) : null}

        {abortable ? (
          <span className="ml-auto">
            <ConfirmActionDialog
              eyebrow="ADVERSARIAL"
              title="Stop exercise"
              description="Aborts the role now. A briefed or active operative receives an immediate STOP. The reason stays staff-internal."
              confirmLabel="Stop exercise"
              tone="danger"
              action={actions.abort}
              hidden={hidden}
              trigger={
                <Button size="sm" variant="ghost" iconLeft={OctagonX} data-testid="abort-role">
                  Stop
                </Button>
              }
            >
              <FormField name="reason" label="Reason" required>
                <Textarea name="reason" required minLength={3} maxLength={500} rows={2} />
              </FormField>
            </ConfirmActionDialog>
          </span>
        ) : null}
      </footer>
    </Card>
  );
}
