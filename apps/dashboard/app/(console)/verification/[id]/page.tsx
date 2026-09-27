import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { can, getProfile, isUuid, loadCatalog, type ProfileView, verification } from '@jave/core';
import {
  Badge,
  buttonStyles,
  Callout,
  Icon,
  Mono,
  PageHeader,
  Panel,
  RankBadge,
  RoleBadge,
  Timeline,
  type TimelineItem,
  type TimelineTone,
} from '@jave/ui';
import { VerificationDecisionControls } from '@/components/verification/decision-controls';
import {
  VerificationEvidence,
  VerificationStatusBadge,
  VerificationTypeBadge,
} from '@/components/verification/verification-parts';
import { formatTimestamp } from '@/lib/time';
import {
  APPROVAL_CONSEQUENCES,
  capabilityLabelFor,
  MY_VERIFICATIONS_HREF,
  OPENED_BY_LABELS,
  verificationTargetLine,
} from '@/lib/verification';
import { requireConsoleContext, type UserContext } from '@/server/context';
import { loadViewer } from '@/server/data/viewer';
import { guarded } from '@/server/guard';
import {
  decideVerificationAction,
  revokeVerificationAction,
  startVerificationReviewAction,
} from './actions';

export const metadata: Metadata = { title: 'Verification' };

type Detail = verification.VerificationDetail;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="type-eyebrow text-fg-subtle">{label}</dt>
      <dd className="mt-1.5 min-w-0 break-words text-body text-fg-muted">{children}</dd>
    </div>
  );
}

/** The subject's profile for the target preview; null when this viewer may not read it. */
async function subjectProfile(ctx: UserContext, memberId: string): Promise<ProfileView | null> {
  const loaded = await guarded(() => getProfile(ctx, { memberId }));
  return loaded.ok ? loaded.value : null;
}

function TargetPreview({
  detail,
  profile,
  capabilityLabel,
}: {
  detail: Detail;
  profile: ProfileView | null;
  /** Skill only: `Domain · Facet`. */
  capabilityLabel: string | null;
}) {
  if (detail.type === 'skill' && detail.facetKey) {
    const facet = profile?.domains
      .flatMap((domain) => domain.facets)
      .find((candidate) => candidate.facetKey === detail.facetKey);
    return (
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        <Fact label="Capability">{capabilityLabel ?? detail.targetLabel}</Fact>
        <Fact label="Requested">
          <RankBadge claimedRank={detail.requestedRank} size="sm" />
        </Fact>
        <Fact label="Now">
          {facet ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <RankBadge
                verifiedRank={facet.verifiedRank}
                claimedRank={facet.claimedRank}
                size="sm"
              />
              {facet.verifiedRank && facet.claimedRank ? (
                <Mono dim className="text-[11px]">
                  claimed {facet.claimedRank}
                </Mono>
              ) : null}
            </span>
          ) : (
            '—'
          )}
        </Fact>
        {detail.grantedRank ? (
          <Fact label="Granted">
            <RankBadge verifiedRank={detail.grantedRank} size="sm" />
          </Fact>
        ) : null}
      </dl>
    );
  }
  if (detail.type === 'identity') {
    return (
      <dl className="grid grid-cols-1 gap-y-4">
        <Fact label="Claim">That this member is who they say they are.</Fact>
        <Fact label="Roles now">
          {profile && profile.roles.length > 0 ? (
            <span className="inline-flex flex-wrap gap-1.5">
              {profile.roles.map((role) => (
                <RoleBadge key={role} role={role} size="sm" />
              ))}
            </span>
          ) : (
            '—'
          )}
        </Fact>
      </dl>
    );
  }
  return (
    <dl className="grid grid-cols-1 gap-y-4 sm:grid-cols-2">
      <Fact label="Target">{detail.targetLabel}</Fact>
      <Fact label="Reference">
        <Mono className="select-all break-all">{detail.targetId ?? '—'}</Mono>
      </Fact>
    </dl>
  );
}

const DECIDED = {
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
} as const satisfies Record<string, { label: string; tone: TimelineTone }>;

function timelineItems(detail: Detail, timeZone: string): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: 'requested',
      at: detail.requestedAt,
      atLabel: formatTimestamp(detail.requestedAt, timeZone),
      title: <span className="type-eyebrow text-fg">Requested</span>,
      meta: OPENED_BY_LABELS[detail.openedBy],
      tone: 'info',
    },
  ];
  if (detail.staff?.reviewStartedAt) {
    items.push({
      id: 'review',
      at: detail.staff.reviewStartedAt,
      atLabel: formatTimestamp(detail.staff.reviewStartedAt, timeZone),
      title: <span className="type-eyebrow text-fg">Review started</span>,
      tone: 'warning',
    });
  }
  if (detail.decidedAt) {
    const outcome = detail.status === 'rejected' ? DECIDED.rejected : DECIDED.approved;
    items.push({
      id: 'decided',
      at: detail.decidedAt,
      atLabel: formatTimestamp(detail.decidedAt, timeZone),
      title: <span className="type-eyebrow text-fg">{outcome.label}</span>,
      meta: detail.staff?.verifier?.name,
      tone: outcome.tone,
    });
  }
  if (detail.status === 'expired' && detail.expiresAt) {
    items.push({
      id: 'expired',
      at: detail.expiresAt,
      atLabel: formatTimestamp(detail.expiresAt, timeZone),
      title: <span className="type-eyebrow text-fg">Expired without a decision</span>,
      tone: 'neutral',
    });
  }
  if (detail.revokedAt) {
    items.push({
      id: 'revoked',
      at: detail.revokedAt,
      atLabel: formatTimestamp(detail.revokedAt, timeZone),
      title: <span className="type-eyebrow text-fg">Revoked</span>,
      meta: detail.staff?.revokedBy?.name,
      tone: 'danger',
    });
  }
  return items.reverse();
}

export default async function VerificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { ctx, actor } = await requireConsoleContext();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const loaded = await guarded(() => verification.getVerification(ctx, id));
  if (!loaded.ok) notFound();
  const detail = loaded.value;
  const staff = can(ctx, 'canVerifyMembers');
  const access = verification.verificationAccess(ctx, detail);
  // A skill approval may only grant a rank above the subject's verified one.
  const grantable =
    detail.type === 'skill' && access.controls.includes('approve')
      ? await verification.listGrantableRanks(ctx, { verificationId: detail.id })
      : null;
  const [viewer, catalog, profile] = await Promise.all([
    loadViewer(ctx),
    loadCatalog(ctx),
    subjectProfile(ctx, detail.subject.memberId),
  ]);
  const tz = viewer.timeZone;
  const open = verification.isOpen(detail.status);
  const nothingToGrant = grantable !== null && grantable.ranks.length === 0;
  const controls = nothingToGrant
    ? access.controls.filter((control) => control !== 'approve')
    : access.controls;
  const blocked = access.blocked && access.blocked !== 'closed' ? access.blocked : null;
  const ownRecord = detail.subject.memberId === actor.memberId;
  const capabilityLabel = capabilityLabelFor(catalog, detail.facetKey);
  const targetLine = verificationTargetLine(detail, capabilityLabel);
  // What an approval would verify, named for the confirmation dialog.
  const dialogTarget =
    detail.type === 'identity'
      ? `the identity of @${detail.subject.handle}`
      : `${verification.TYPE_LABELS[detail.type]} · ${targetLine}`;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={staff ? 'PEOPLE / VERIFICATION' : 'VERIFICATION'}
        title={detail.reference}
        description={targetLine}
        meta={
          <>
            <VerificationStatusBadge status={detail.status} />
            <VerificationTypeBadge type={detail.type} />
            {open && detail.expiresAt ? (
              <Mono dim>Expires {formatTimestamp(detail.expiresAt, tz)}</Mono>
            ) : null}
          </>
        }
        actions={
          <Link
            href={ownRecord ? MY_VERIFICATIONS_HREF : '/verification'}
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          >
            <Icon icon={ArrowLeft} size="sm" />
            {ownRecord ? 'My verifications' : 'Queue'}
          </Link>
        }
      />

      {controls.length > 0 ? (
        <VerificationDecisionControls
          verificationId={detail.id}
          reference={detail.reference}
          target={dialogTarget}
          consequence={APPROVAL_CONSEQUENCES[detail.type]}
          controls={controls}
          skill={
            grantable
              ? {
                  tiers: grantable.ranks,
                  requested: detail.requestedRank,
                  current: grantable.currentVerifiedRank,
                }
              : null
          }
          limits={{ note: verification.TEXT_LIMITS.note, reason: verification.TEXT_LIMITS.reason }}
          actions={{
            startReview: startVerificationReviewAction,
            decide: decideVerificationAction,
            revoke: revokeVerificationAction,
          }}
        />
      ) : null}
      {blocked ? (
        <Callout tone="neutral" title="NO CONTROLS FOR YOU HERE">
          {verification.VERIFICATION_BLOCK_MESSAGES[blocked]}
        </Callout>
      ) : null}
      {nothingToGrant ? (
        <Callout tone="neutral" title="NOTHING HIGHER TO GRANT">
          {capabilityLabel ?? detail.targetLabel} is already verified at{' '}
          {grantable?.currentVerifiedRank ?? '—'}. Approving could not raise it; reject this request
          instead.
        </Callout>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Claim" description="In the requester’s words.">
            <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-fg">
              {detail.claim}
            </p>
          </Panel>
          <Panel title="Target" description="What approval would verify.">
            <TargetPreview detail={detail} profile={profile} capabilityLabel={capabilityLabel} />
          </Panel>
          <Panel
            title="Evidence"
            description={`${detail.evidenceCount} item${detail.evidenceCount === 1 ? '' : 's'} linked. Links open in a new tab without a referrer.`}
            flush
          >
            <VerificationEvidence items={detail.evidence} timeZone={tz} />
          </Panel>
          {detail.decisionNote || detail.revokeReason ? (
            <Panel title="Decision">
              <div className="space-y-4">
                {detail.decisionNote ? (
                  <section className="space-y-1.5">
                    <h3 className="type-eyebrow text-fg-subtle">Note</h3>
                    <p className="whitespace-pre-wrap break-words text-body text-fg-muted">
                      {detail.decisionNote}
                    </p>
                  </section>
                ) : null}
                {detail.revokeReason ? (
                  <section className="space-y-1.5">
                    <h3 className="type-eyebrow text-fg-subtle">Revocation reason</h3>
                    <p className="whitespace-pre-wrap break-words text-body text-fg-muted">
                      {detail.revokeReason}
                    </p>
                  </section>
                ) : null}
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Panel title="Summary">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-1">
              <Fact label="Subject">
                {staff ? (
                  <Link
                    href={`/members/${detail.subject.memberId}`}
                    className="font-medium text-fg underline-offset-4 hover:underline"
                  >
                    {detail.subject.displayName}
                  </Link>
                ) : (
                  <span className="font-medium text-fg">{detail.subject.displayName}</span>
                )}{' '}
                <Mono dim className="text-[12px]">
                  @{detail.subject.handle}
                </Mono>
              </Fact>
              <Fact label="Opened by">{OPENED_BY_LABELS[detail.openedBy]}</Fact>
              {staff ? (
                <Fact label="Verifier">
                  {detail.assignedVerifier ? detail.assignedVerifier.name : 'Unassigned'}
                </Fact>
              ) : null}
              {detail.staff?.requestedBy && detail.openedBy === 'staff' ? (
                <Fact label="Requested by">{detail.staff.requestedBy.name}</Fact>
              ) : null}
              {detail.staff?.verifier ? (
                <Fact label="Decided by">{detail.staff.verifier.name}</Fact>
              ) : null}
              {detail.staff?.revokedBy ? (
                <Fact label="Revoked by">{detail.staff.revokedBy.name}</Fact>
              ) : null}
            </dl>
          </Panel>
          <Panel title="Timeline">
            <Timeline items={timelineItems(detail, tz)} label="Verification history" />
          </Panel>
          {staff ? (
            <p className="flex items-center gap-2 text-small text-fg-subtle">
              <Badge tone="warning">STAFF</Badge>
              Requester, verifier and assignment are hidden from the member.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
