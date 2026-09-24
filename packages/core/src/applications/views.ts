import {
  type ApplicationRecord,
  type ApplicationReviewRecord,
  type ApplicationStatusChangeRecord,
  applicationNumber,
  type PersonRef,
} from './repository';
import {
  type ApplicationRequirement,
  draftExpiresAt,
  missingRequirements,
  type ReviewTally,
  tallyReviews,
} from './rules';
import {
  type ApplicationRecommendation,
  type ApplicationStatus,
  isTerminalStatus,
} from './state-machine';

/**
 * View models. The applicant view is built field by field (never spread from
 * the row) so private staff data cannot leak by accident: no decision
 * reason, no reviews, no reviewer or decider identity.
 */

export interface ApplicantTimelineEntry {
  status: ApplicationStatus;
  at: Date;
}

export interface ApplicantApplicationView {
  id: string;
  number: string;
  status: ApplicationStatus;
  domainKey: string | null;
  motivation: string | null;
  experience: string | null;
  projects: string | null;
  portfolioUrl: string | null;
  evidenceLinks: string[];
  /** The applicant's own references, shown back only to them. */
  references: string | null;
  referralCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  interviewAt: Date | null;
  decidedAt: Date | null;
  /** Staff's message to the applicant, once decided. */
  applicantMessage: string | null;
  readiness: { ready: boolean; missing: ApplicationRequirement[] };
  /** When an untouched draft is withdrawn automatically; null once submitted. */
  draftExpiresAt: Date | null;
  timeline: ApplicantTimelineEntry[];
}

export function toApplicantView(
  app: ApplicationRecord,
  history: readonly ApplicationStatusChangeRecord[],
  options: { draftExpiryDays: number },
): ApplicantApplicationView {
  const missing = missingRequirements(app);
  return {
    id: app.id,
    number: applicationNumber(app),
    status: app.status,
    domainKey: app.domainKey,
    motivation: app.motivation,
    experience: app.experience,
    projects: app.projects,
    portfolioUrl: app.portfolioUrl,
    evidenceLinks: [...app.evidenceLinks],
    references: app.references,
    referralCode: app.referralCode,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    submittedAt: app.submittedAt,
    interviewAt: app.status === 'interview' ? app.interviewAt : null,
    decidedAt: app.decidedAt,
    applicantMessage: isTerminalStatus(app.status) ? app.applicantMessage : null,
    readiness: { ready: missing.length === 0, missing },
    draftExpiresAt:
      app.status === 'draft' ? draftExpiresAt(app.updatedAt, options.draftExpiryDays) : null,
    timeline: history.map((change) => ({ status: change.toStatus, at: change.createdAt })),
  };
}

export interface ApplicationListItem {
  id: string;
  number: string;
  status: ApplicationStatus;
  domainKey: string | null;
  applicant: PersonRef | null;
  assignedReviewer: PersonRef | null;
  reviewCount: number;
  submittedAt: Date | null;
  interviewAt: Date | null;
  decidedAt: Date | null;
  updatedAt: Date;
}

export interface StaffReviewView {
  reviewer: PersonRef | null;
  reviewerUserId: string;
  recommendation: ApplicationRecommendation;
  score: number | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffStatusChangeView {
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  actor: PersonRef | null;
  note: string | null;
  at: Date;
}

export interface StaffApplicationView {
  id: string;
  number: string;
  status: ApplicationStatus;
  applicant: PersonRef | null;
  domainKey: string | null;
  motivation: string | null;
  experience: string | null;
  projects: string | null;
  portfolioUrl: string | null;
  evidenceLinks: string[];
  /** Private. Only returned to holders of canViewApplications. */
  references: string | null;
  referral: { code: string; owner: PersonRef | null } | null;
  assignedReviewer: PersonRef | null;
  submittedAt: Date | null;
  interviewAt: Date | null;
  decidedAt: Date | null;
  decidedBy: PersonRef | null;
  decisionReason: string | null;
  applicantMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviews: StaffReviewView[];
  tally: ReviewTally;
  history: StaffStatusChangeView[];
}

export function toStaffView(
  app: ApplicationRecord,
  reviews: readonly ApplicationReviewRecord[],
  history: readonly ApplicationStatusChangeRecord[],
  people: ReadonlyMap<string, PersonRef>,
  referralOwnerUserId: string | null,
): StaffApplicationView {
  const person = (userId: string | null) => (userId ? (people.get(userId) ?? null) : null);
  return {
    id: app.id,
    number: applicationNumber(app),
    status: app.status,
    applicant: person(app.userId),
    domainKey: app.domainKey,
    motivation: app.motivation,
    experience: app.experience,
    projects: app.projects,
    portfolioUrl: app.portfolioUrl,
    evidenceLinks: [...app.evidenceLinks],
    references: app.references,
    referral: app.referralCode
      ? { code: app.referralCode, owner: person(referralOwnerUserId) }
      : null,
    assignedReviewer: person(app.assignedReviewerUserId),
    submittedAt: app.submittedAt,
    interviewAt: app.interviewAt,
    decidedAt: app.decidedAt,
    decidedBy: person(app.decidedByUserId),
    decisionReason: app.decisionReason,
    applicantMessage: app.applicantMessage,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    reviews: reviews.map((review) => ({
      reviewer: person(review.reviewerUserId),
      reviewerUserId: review.reviewerUserId,
      recommendation: review.recommendation,
      score: review.score,
      note: review.note,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    })),
    tally: tallyReviews(reviews),
    history: history.map((change) => ({
      from: change.fromStatus,
      to: change.toStatus,
      actor: person(change.actorUserId),
      note: change.note,
      at: change.createdAt,
    })),
  };
}
