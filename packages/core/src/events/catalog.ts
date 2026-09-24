/**
 * Domain event catalog. Every event type JAVE emits is declared here.
 * `external: false` events never leave JAVE (outbound webhooks skip them).
 */
export interface DomainEventDefinition {
  description: string;
  external: boolean;
}

export const DOMAIN_EVENTS = {
  'member.joined': { description: 'A user joined the Discord server.', external: true },
  'member.left': { description: 'A user left the Discord server.', external: true },
  'member.onboarded': { description: 'A member completed onboarding.', external: true },
  'member.profile_updated': { description: 'A member profile was edited.', external: false },
  'member.role_granted': { description: 'An organizational role was granted.', external: true },
  'member.role_revoked': { description: 'An organizational role was revoked.', external: true },
  'capability.claimed': {
    description: 'A member claimed a rank for a capability.',
    external: false,
  },
  'capability.verified': { description: 'An evaluator set a verified rank.', external: true },
  'evidence.submitted': { description: 'Evidence was submitted.', external: false },
  'evidence.reviewed': { description: 'Evidence was accepted or rejected.', external: false },

  'application.submitted': { description: 'An application was submitted.', external: true },
  'application.status_changed': {
    description: 'An application moved to a new state.',
    external: false,
  },
  'application.accepted': { description: 'An application was accepted.', external: true },
  'application.rejected': { description: 'An application was rejected.', external: false },
  'application.withdrawn': { description: 'An applicant withdrew.', external: false },

  'verification.requested': { description: 'A verification was requested.', external: false },
  'verification.approved': { description: 'A verification was approved.', external: true },
  'verification.rejected': { description: 'A verification was rejected.', external: false },
  'verification.revoked': { description: 'A verification was revoked.', external: false },

  'trial.created': { description: 'A trial was created.', external: false },
  'trial.recruiting': { description: 'A trial opened recruitment.', external: true },
  'trial.participant_applied': { description: 'A member applied to a trial.', external: false },
  'trial.participant_selected': {
    description: 'A member was selected for a trial.',
    external: false,
  },
  'trial.teams_assigned': { description: 'Trial teams were assigned.', external: false },
  'trial.started': { description: 'A trial started.', external: true },
  'trial.submission_received': { description: 'A team submitted.', external: false },
  'trial.submissions_closed': { description: 'The trial deadline passed.', external: false },
  'trial.completed': { description: 'Trial results were published.', external: true },
  'trial.result_published': {
    description: 'A participant received their result.',
    external: false,
  },
  'trial.passed': { description: 'A participant passed a trial.', external: true },
  'trial.cancelled': { description: 'A trial was cancelled.', external: false },

  'adversarial.revealed': {
    description: 'An adversarial role was revealed after a trial.',
    external: false,
  },

  'mission.published': { description: 'A mission opened.', external: true },
  'mission.assigned': { description: 'A mission was assigned.', external: false },
  'mission.submitted': { description: 'A mission submission was received.', external: false },
  'mission.completed': { description: 'A mission submission was verified.', external: true },
  'mission.rejected': { description: 'A mission submission was rejected.', external: false },
  'mission.expired': { description: 'A mission assignment expired.', external: false },

  'project.created': { description: 'A project was created.', external: true },
  'project.status_changed': { description: 'A project changed status.', external: true },
  'project.shipped': { description: 'A project shipped.', external: true },
  'project.member_added': { description: 'A member joined a project.', external: false },
  'contribution.submitted': { description: 'A contribution was recorded.', external: false },
  'contribution.verified': { description: 'A contribution was verified.', external: true },

  'event.created': { description: 'An event was scheduled.', external: true },
  'event.rsvp': { description: 'A member responded to an event.', external: false },
  'event.checked_in': { description: 'A member checked in to an event.', external: false },
  'event.completed': { description: 'An event concluded.', external: true },
  'tournament.match_completed': { description: 'A tournament match concluded.', external: false },

  'ticket.opened': { description: 'A ticket was opened.', external: false },
  'ticket.claimed': { description: 'A ticket was claimed.', external: false },
  'ticket.closed': { description: 'A ticket was closed.', external: false },
  'ticket.reopened': { description: 'A ticket was reopened.', external: false },

  'moderation.case_created': { description: 'A moderation case was recorded.', external: false },
  'security.event_raised': { description: 'A security event was raised.', external: false },

  'achievement.unlocked': { description: 'A member unlocked an achievement.', external: true },
  'research.submitted': { description: 'A research item was saved.', external: true },
  'research.reviewed': { description: 'A research item was reviewed.', external: false },
  'research.verified': { description: 'A research item was verified.', external: true },
  'referral.validated': { description: 'A referral became valid.', external: false },
  'game.completed': { description: 'A game session finished.', external: false },
  'ai.action_executed': {
    description: 'A confirmed AI-proposed action executed.',
    external: false,
  },
  'settings.updated': { description: 'Server settings changed.', external: false },
  'moderation.case_revoked': { description: 'A moderation case was revoked.', external: false },
  'security.event_reviewed': { description: 'A security event was reviewed.', external: false },
  'security.raid_mode_changed': {
    description: 'Raid mode was switched on or off.',
    external: false,
  },
} as const satisfies Record<string, DomainEventDefinition>;

export type DomainEventType = keyof typeof DOMAIN_EVENTS;

export const DOMAIN_EVENT_TYPES = Object.keys(DOMAIN_EVENTS) as DomainEventType[];

export function isDomainEventType(value: string): value is DomainEventType {
  return value in DOMAIN_EVENTS;
}
