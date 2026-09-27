import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, CircleCheck, CircleDashed, DoorOpen, UserRoundX } from 'lucide-react';
import { applications, getSettings, loadCatalog } from '@jave/core';
import {
  Badge,
  buttonStyles,
  Callout,
  Card,
  EmptyState,
  Icon,
  Mono,
  PageHeader,
  Panel,
} from '@jave/ui';
import {
  StartApplicationButton,
  SubmitApplicationDialog,
  WithdrawApplicationDialog,
} from '@/components/applications/applicant-actions';
import {
  Answer,
  ApplicationStatusBadge,
  LinkList,
  StatusTimeline,
} from '@/components/applications/application-parts';
import { DraftForm } from '@/components/applications/draft-form';
import { formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import {
  saveDraftAction,
  startApplicationAction,
  submitApplicationAction,
  withdrawApplicationAction,
} from './actions';

export const metadata: Metadata = { title: 'My application' };

type MyApplication = applications.MyApplicationStatus;
type ApplicantView = applications.ApplicantApplicationView;

const IN_FLIGHT_COPY: Partial<Record<applications.ApplicationStatus, string>> = {
  submitted: 'In the review queue. You are told when a reviewer picks it up.',
  review: 'A reviewer is working on it. Updates arrive by DM and in your notifications.',
  interview: 'Staff want to talk to you before deciding. The invitation has the details.',
};

const CLOSED_COPY: Partial<Record<applications.ApplicationStatus, string>> = {
  accepted:
    'Accepted. Your role was updated; ranks are earned next, through trials and verification.',
  rejected: 'Not accepted this time. You can prepare a new application.',
  withdrawn: 'Withdrawn. You can start a new application.',
};

const STEPS = [
  { title: 'Draft', detail: 'Private to you. Save as often as you like.' },
  { title: 'Submit', detail: 'Answers lock; the review team can read them.' },
  { title: 'Review', detail: 'Reviewers weigh the evidence. Sometimes an interview.' },
  { title: 'Decision', detail: 'You are told either way, with a note from staff.' },
] as const;

function Header({ actions }: { actions?: ReactNode }) {
  return (
    <PageHeader
      eyebrow="ACCOUNT"
      title="Application"
      description="Apply to JAVELIN. Staff see nothing until you submit; your references stay with the review team."
      actions={
        actions ?? (
          <Link href="/me" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
            <Icon icon={ArrowLeft} size="sm" />
            My profile
          </Link>
        )
      }
    />
  );
}

function Readiness({ app }: { app: ApplicantView }) {
  if (app.readiness.ready) {
    return (
      <p className="flex items-start gap-2 text-small text-fg-muted">
        <Icon icon={CircleCheck} className="mt-0.5 text-success" />
        Every requirement is met.
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Missing before submission">
      {app.readiness.missing.map((requirement) => (
        <li key={requirement} className="flex items-start gap-2 text-small text-fg-muted">
          <Icon icon={CircleDashed} className="mt-0.5 text-fg-subtle" />
          {applications.REQUIREMENT_MESSAGES[requirement]}
        </li>
      ))}
    </ul>
  );
}

function cooldownLine(status: MyApplication, timeZone: string): string {
  return status.withdrawalCooldownEndsAt
    ? `You could submit again from ${formatTimestamp(status.withdrawalCooldownEndsAt, timeZone)} ${timeZone}.`
    : 'You can start again at any time.';
}

function Timeline({ app, timeZone }: { app: ApplicantView; timeZone: string }) {
  return (
    <StatusTimeline
      timeZone={timeZone}
      entries={app.timeline.map((entry, index) => ({
        to: entry.status,
        from: index > 0 ? (app.timeline[index - 1]?.status ?? null) : null,
        at: entry.at,
      }))}
    />
  );
}

function ReadOnlyAnswers({ app, domainLabel }: { app: ApplicantView; domainLabel: string }) {
  return (
    <Panel title="Your answers" description="Locked once submitted.">
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="type-eyebrow text-fg-subtle">Primary domain</h3>
          <Badge>{domainLabel}</Badge>
        </section>
        <Answer label="Why JAVELIN" text={app.motivation} />
        <Answer label="Experience" text={app.experience} />
        <Answer label="Projects" text={app.projects} />
        <section className="space-y-2">
          <h3 className="type-eyebrow text-fg-subtle">Proof of work</h3>
          <LinkList
            links={[...(app.portfolioUrl ? [app.portfolioUrl] : []), ...app.evidenceLinks]}
            empty="No links."
          />
        </section>
        <Answer label="References (staff only)" text={app.references} />
      </div>
    </Panel>
  );
}

/** Why no new application can start, or null when one can. */
function startBlocker(status: MyApplication): ReactNode | null {
  if (!status.eligible) {
    return (
      <Card padding="none">
        <EmptyState
          icon={DoorOpen}
          title="ALREADY INSIDE JAVELIN"
          description="Your roles already place you inside JAVELIN. No application needed. Prove capability through trials and verification."
        />
      </Card>
    );
  }
  if (!status.applicationsOpen) {
    return (
      <Card padding="none">
        <EmptyState
          icon={DoorOpen}
          title="APPLICATIONS PAUSED"
          description="New applications are closed for now. Check back later."
        />
      </Card>
    );
  }
  return null;
}

export default async function MyApplicationPage() {
  const { ctx, actor } = await requireConsoleContext();
  if (!actor.memberId) {
    return (
      <div className="space-y-8">
        <Header />
        <Card padding="none">
          <EmptyState
            icon={UserRoundX}
            title="NO JAVELIN PROFILE"
            description="Join the JAVELIN Discord, then sign in again."
          />
        </Card>
      </div>
    );
  }
  const [status, catalog, viewer, settings] = await Promise.all([
    applications.getMyApplication(ctx),
    loadCatalog(ctx),
    loadViewer(ctx),
    getSettings(ctx, 'applications'),
  ]);
  const tz = viewer.timeZone;
  const app = status.application;
  const domains = catalog.domains.map((domain) => ({ value: domain.key, label: domain.label }));
  const domainLabel = (key: string | null) =>
    catalog.domains.find((domain) => domain.key === key)?.label ?? '—';
  const open = app && applications.isOpenStatus(app.status) ? app : null;

  if (open?.status === 'draft') {
    return (
      <div className="space-y-8">
        <Header />
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel
            title={`${open.number} — draft`}
            description="Private to you. Save as often as you like; submit when every requirement is met."
          >
            <DraftForm
              fields={applications.APPLICATION_FORM_FIELDS}
              domains={domains}
              values={{
                domainKey: open.domainKey ?? '',
                motivation: open.motivation ?? '',
                experience: open.experience ?? '',
                projects: open.projects ?? '',
                portfolioUrl: open.portfolioUrl ?? '',
                evidenceLinks: open.evidenceLinks.join('\n'),
                references: open.references ?? '',
                referralCode: open.referralCode ?? '',
              }}
              action={saveDraftAction}
            />
          </Panel>
          <div className="space-y-6 lg:sticky lg:top-20">
            <Panel title={open.readiness.ready ? 'Ready' : 'Before you submit'}>
              <div className="space-y-5">
                <Readiness app={open} />
                {status.cooldownEndsAt ? (
                  <Callout tone="warning" title="COOLDOWN">
                    You can submit from {formatTimestamp(status.cooldownEndsAt, tz)} {tz}. You can
                    prepare the draft until then.
                  </Callout>
                ) : null}
                {open.readiness.ready && !status.cooldownEndsAt ? (
                  <SubmitApplicationDialog number={open.number} action={submitApplicationAction} />
                ) : null}
                <WithdrawApplicationDialog
                  number={open.number}
                  draft
                  cost="You can start again at any time."
                  reasonMaxLength={applications.APPLICATION_FIELD_LIMITS.withdrawReason}
                  action={withdrawApplicationAction}
                />
              </div>
            </Panel>
            {open.draftExpiresAt ? (
              <p className="text-small text-fg-subtle">
                Untouched drafts close on <Mono>{formatTimestamp(open.draftExpiresAt, tz)}</Mono>.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (open) {
    return (
      <div className="space-y-8">
        <Header />
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <ReadOnlyAnswers app={open} domainLabel={domainLabel(open.domainKey)} />
          <div className="space-y-6">
            <Panel title={open.number} actions={<ApplicationStatusBadge status={open.status} />}>
              <div className="space-y-5">
                <p className="text-small text-fg-muted">{IN_FLIGHT_COPY[open.status]}</p>
                {open.interviewAt ? (
                  <div>
                    <p className="type-eyebrow text-fg-subtle">Interview</p>
                    <p className="mt-1.5">
                      <Mono className="text-fg">{formatTimestamp(open.interviewAt, tz)}</Mono>{' '}
                      <Mono dim>{tz}</Mono>
                    </p>
                  </div>
                ) : null}
                <WithdrawApplicationDialog
                  number={open.number}
                  draft={false}
                  cost={cooldownLine(status, tz)}
                  reasonMaxLength={applications.APPLICATION_FIELD_LIMITS.withdrawReason}
                  action={withdrawApplicationAction}
                />
              </div>
            </Panel>
            <Panel title="Timeline">
              <Timeline app={open} timeZone={tz} />
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  const blocked = startBlocker(status);
  return (
    <div className="space-y-8">
      <Header />
      {app ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Panel title={app.number} actions={<ApplicationStatusBadge status={app.status} />}>
            <div className="space-y-5">
              <p className="text-body text-fg-muted">{CLOSED_COPY[app.status]}</p>
              {app.applicantMessage ? (
                <Answer label="Message from staff" text={app.applicantMessage} />
              ) : null}
              {app.decidedAt ? (
                <p className="text-small text-fg-subtle">
                  Decided <Mono>{formatTimestamp(app.decidedAt, tz)}</Mono>
                </p>
              ) : null}
            </div>
          </Panel>
          <Panel title="Timeline">
            <Timeline app={app} timeZone={tz} />
          </Panel>
        </div>
      ) : null}
      {blocked ?? (
        <Card className="max-w-4xl">
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="type-eyebrow text-fg-subtle">
                {app ? 'NEW APPLICATION' : 'YOU THINK YOU’RE ELITE? PROVE IT.'}
              </p>
              <h2 className="type-heading text-fg">Apply to JAVELIN</h2>
              <p className="max-w-2xl text-body text-fg-muted">
                Tell us what you build, research or pursue, and show proof of work. Staff review
                every application. An accepted application grants{' '}
                {settings.acceptedRole.toUpperCase()}; ranks are earned after that, never claimed
                into being.
              </p>
            </div>
            <ol
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="How it works"
            >
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-md border border-line-subtle px-4 py-3">
                  <p className="type-data text-small text-fg-subtle">0{index + 1}</p>
                  <p className="mt-1 text-body font-medium text-fg">{step.title}</p>
                  <p className="mt-0.5 text-small text-fg-subtle">{step.detail}</p>
                </li>
              ))}
            </ol>
            {status.cooldownEndsAt ? (
              <Callout tone="warning" title="COOLDOWN">
                You can submit again from {formatTimestamp(status.cooldownEndsAt, tz)} {tz}. You can
                prepare a draft before then.
              </Callout>
            ) : null}
            <StartApplicationButton
              action={startApplicationAction}
              label={app ? 'Start new application' : 'Start application'}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
