import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { applications, can, isUuid, loadCatalog } from '@jave/core';
import {
  Avatar,
  Badge,
  buttonStyles,
  Callout,
  Card,
  Icon,
  Mono,
  PageHeader,
  Panel,
  RestrictedState,
} from '@jave/ui';
import {
  Answer,
  ApplicationStatusBadge,
  LinkList,
  PersonName,
  ReviewList,
  StatusTimeline,
} from '@/components/applications/application-parts';
import { ApplicationStaffActions } from '@/components/applications/staff-actions';
import { toDatetimeLocal } from '@/lib/datetime-local';
import { formatTimestamp } from '@/lib/time';
import { requireConsoleContext } from '@/server/context';
import { loadStaffApplication, type StaffApplicationPage } from '@/server/data/application-view';
import { loadViewer } from '@/server/data/viewer';
import {
  claimApplicationAction,
  decideApplicationAction,
  reviewApplicationAction,
  scheduleInterviewAction,
} from './actions';

export const metadata: Metadata = { title: 'Application' };

const STAFF_LIMITS = {
  reviewNote: applications.APPLICATION_FIELD_LIMITS.reviewNote,
  decisionReason: applications.APPLICATION_FIELD_LIMITS.decisionReason,
  applicantMessage: applications.APPLICATION_FIELD_LIMITS.applicantMessage,
  interviewNote: applications.APPLICATION_FIELD_LIMITS.interviewNote,
};

function BackLink() {
  return (
    <Link href="/applications" className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
      <Icon icon={ArrowLeft} size="sm" />
      Queue
    </Link>
  );
}

function consequences(page: StaffApplicationPage) {
  const role = page.settings.acceptedRole.toUpperCase();
  return {
    accept: `Grants ${role} (never a demotion) and notifies the applicant. The internal reason stays in the staff record.`,
    reject: `Returns APPLICANT to MEMBER, notifies the applicant and blocks a new submission for ${page.settings.cooldownDays} days.`,
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 min-w-0 text-body text-fg-muted">{children}</dd>
    </div>
  );
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, actor } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const loaded = await loadStaffApplication(ctx, id);
  if (!loaded.ok) {
    // With application access, the only refusal left is the viewer's own application.
    const ownApplication = can(ctx, 'canViewApplications');
    return (
      <>
        <PageHeader eyebrow="PEOPLE / APPLICATION" title="Application" actions={<BackLink />} />
        <Card padding="none" className="mt-8">
          <RestrictedState
            description={loaded.reason}
            requirement={ownApplication ? undefined : 'canViewApplications'}
            action={
              ownApplication ? (
                <Link href="/me/application" className={buttonStyles({ variant: 'secondary' })}>
                  Open your application
                </Link>
              ) : undefined
            }
          />
        </Card>
      </>
    );
  }
  const page = loaded.page;
  const { view, card } = page;
  const [viewer, catalog] = await Promise.all([loadViewer(ctx), loadCatalog(ctx)]);
  const tz = viewer.timeZone;
  const domain = catalog.domains.find((entry) => entry.key === view.domainKey);
  const myReview = view.reviews.find((review) => review.reviewerUserId === actor.userId) ?? null;
  const linkPeople = can(ctx, 'canViewMembers');
  const decides = can(ctx, 'canDecideApplications');
  const undecided = applications.IN_FLIGHT_STATUSES.includes(view.status);
  const anyControl = Object.values(page.controls).some(Boolean);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="PEOPLE / APPLICATION"
        title={view.number}
        description={
          view.applicant ? (
            <span className="inline-flex items-center gap-2.5">
              <Avatar name={view.applicant.displayName} size="sm" />
              <PersonName person={view.applicant} link={linkPeople} />
            </span>
          ) : undefined
        }
        meta={
          <>
            <ApplicationStatusBadge status={view.status} />
            {domain ? <Badge>{domain.label}</Badge> : null}
            {view.submittedAt ? (
              <Mono dim>Submitted {formatTimestamp(view.submittedAt, tz)}</Mono>
            ) : null}
          </>
        }
        actions={<BackLink />}
      />

      {anyControl ? (
        <ApplicationStaffActions
          applicationId={view.id}
          number={view.number}
          can={page.controls}
          myReview={
            myReview
              ? {
                  recommendation: myReview.recommendation,
                  score: myReview.score,
                  note: myReview.note,
                }
              : null
          }
          interview={{
            current: view.interviewAt ? toDatetimeLocal(view.interviewAt, tz) : null,
            timeZone: tz,
          }}
          consequences={consequences(page)}
          limits={STAFF_LIMITS}
          actions={{
            claim: claimApplicationAction,
            review: reviewApplicationAction,
            interview: scheduleInterviewAction,
            decide: decideApplicationAction,
          }}
        />
      ) : null}
      {undecided && decides && !card.decisionReady ? (
        <Callout tone="neutral" title="DECISION LOCKED">
          Accept and reject unlock after {page.settings.minReviews} counted review
          {page.settings.minReviews === 1 ? '' : 's'}. {card.tally.counted} so far; abstentions do
          not count.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Answers" description="As the applicant wrote them.">
            <div className="space-y-6">
              <Answer label="Why JAVELIN" text={view.motivation} />
              <Answer label="Experience" text={view.experience} />
              <Answer label="Projects" text={view.projects} />
            </div>
          </Panel>
          <Panel title="Proof of work" description="Links open in a new tab without a referrer.">
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="type-eyebrow text-fg-subtle">Portfolio</h3>
                <LinkList
                  links={view.portfolioUrl ? [view.portfolioUrl] : []}
                  empty="No portfolio."
                />
              </section>
              <section className="space-y-2">
                <h3 className="type-eyebrow text-fg-subtle">
                  Evidence links · {view.evidenceLinks.length}
                </h3>
                <LinkList links={view.evidenceLinks} empty="No evidence links." />
              </section>
            </div>
          </Panel>
          <Panel
            title="References"
            description="Private to staff with application access. Never on the Discord card."
            actions={<Badge tone="warning">STAFF ONLY</Badge>}
          >
            <Answer label="Who can vouch" text={view.references} />
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Summary">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-1">
              <Fact label="Reviewer">
                {view.assignedReviewer ? (
                  <PersonName person={view.assignedReviewer} link={false} />
                ) : (
                  'Unclaimed'
                )}
              </Fact>
              <Fact label="Interview">
                {view.interviewAt ? (
                  <Mono className="text-fg">{formatTimestamp(view.interviewAt, tz)}</Mono>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label="Referral">
                {view.referral ? (
                  <span className="inline-flex flex-wrap items-baseline gap-x-2">
                    <Mono className="text-fg">{view.referral.code}</Mono>
                    {view.referral.owner ? (
                      <PersonName person={view.referral.owner} link={false} />
                    ) : null}
                  </span>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label="Reviews">
                <Mono className="text-fg">{card.tally.counted}</Mono> counted
                {card.tally.averageScore !== null ? (
                  <>
                    {' · avg '}
                    <Mono className="text-fg">{card.tally.averageScore.toFixed(1)}</Mono>/5
                  </>
                ) : null}
              </Fact>
            </dl>
          </Panel>
          {view.decidedAt ? (
            <Panel title="Decision" actions={<Badge tone="warning">STAFF ONLY</Badge>}>
              <div className="space-y-4">
                <p className="flex flex-wrap items-baseline gap-x-2 text-small text-fg-subtle">
                  <Mono>{formatTimestamp(view.decidedAt, tz)}</Mono>
                  {view.decidedBy ? <PersonName person={view.decidedBy} link={false} /> : null}
                </p>
                <Answer label="Internal reason" text={view.decisionReason} />
                <Answer label="Message to the applicant" text={view.applicantMessage} />
              </div>
            </Panel>
          ) : null}
          <Panel title="Reviews" flush>
            <ReviewList reviews={view.reviews} timeZone={tz} viewerUserId={actor.userId} />
          </Panel>
          <Panel title="Timeline">
            <StatusTimeline
              timeZone={tz}
              entries={view.history.map((change) => ({
                from: change.from,
                to: change.to,
                at: change.at,
                actor: change.actor?.displayName,
                note: change.note,
              }))}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
