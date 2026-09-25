export type NotificationSeverity = 'info' | 'notice' | 'important' | 'critical';
export type NotificationChannel =
  'discord_dm' | 'discord_channel' | 'dashboard' | 'email' | 'webhook';

export interface NotificationTypeDefinition {
  label: string;
  description: string;
  severity: NotificationSeverity;
  /** Push channels used by default (the dashboard inbox always receives it). */
  channels: readonly NotificationChannel[];
  /** Staff-only types are never offered to regular members in preferences. */
  staff?: boolean;
}

export const NOTIFICATION_TYPES = {
  'application.received': {
    label: 'Application received',
    description: 'A new application needs review.',
    severity: 'notice',
    channels: ['discord_dm'],
    staff: true,
  },
  'application.updated': {
    label: 'Application updated',
    description: 'Your application changed status.',
    severity: 'important',
    channels: ['discord_dm'],
  },
  'verification.completed': {
    label: 'Verification completed',
    description: 'A verification you requested was decided.',
    severity: 'important',
    channels: ['discord_dm'],
  },
  'rank.updated': {
    label: 'Rank updated',
    description: 'An evaluator updated one of your verified ranks.',
    severity: 'important',
    channels: ['discord_dm'],
  },
  'trial.starting': {
    label: 'Trial starting',
    description: 'A trial you are in is about to start or has started.',
    severity: 'important',
    channels: ['discord_dm'],
  },
  'trial.deadline': {
    label: 'Trial deadline',
    description: 'Your trial deadline is approaching.',
    severity: 'important',
    channels: ['discord_dm'],
  },
  'trial.result': {
    label: 'Trial result',
    description: 'Your trial result is available.',
    severity: 'important',
    channels: ['discord_dm'],
  },
  'mission.assigned': {
    label: 'Mission assigned',
    description: 'You were assigned a mission.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'mission.deadline': {
    label: 'Mission deadline',
    description: 'A mission deadline is approaching.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'mission.reviewed': {
    label: 'Mission reviewed',
    description: 'Your mission submission was reviewed.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'ticket.updated': {
    label: 'Ticket updated',
    description: 'A ticket you opened or handle changed.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'project.updated': {
    label: 'Project update',
    description: 'A project you belong to changed.',
    severity: 'info',
    channels: [],
  },
  'achievement.unlocked': {
    label: 'Achievement unlocked',
    description: 'You unlocked an achievement.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'event.reminder': {
    label: 'Event reminder',
    description: 'An event you RSVP’d to is starting soon.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'security.alert': {
    label: 'Security alert',
    description: 'A security event needs attention.',
    severity: 'critical',
    channels: ['discord_dm'],
    staff: true,
  },
  'system.announcement': {
    label: 'Announcement',
    description: 'Organization-wide announcements.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'achievement.updated': {
    label: 'Achievement updated',
    description: 'One of your achievements was verified or revoked.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'adversarial.briefing': {
    label: 'Confidential briefing',
    description: 'Updates about an authorized exercise you operate in.',
    severity: 'important',
    channels: ['discord_dm'],
  },
  'adversarial.stop': {
    label: 'Exercise stop',
    description: 'An exercise you operate in was stopped. The STOP DM is sent separately.',
    severity: 'critical',
    channels: [],
  },
  'adversarial.revealed': {
    label: 'Exercise revealed',
    description: 'A trial you took part in included an authorized security-culture exercise.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'adversarial.staff': {
    label: 'Adversarial operations',
    description: 'Authorization requests, delivery problems and pending reveals.',
    severity: 'notice',
    channels: ['discord_dm'],
    staff: true,
  },
  'adversarial.alert': {
    label: 'Adversarial alert',
    description: 'RED FLAG raised, or a STOP notice could not be delivered.',
    severity: 'critical',
    channels: ['discord_dm'],
    staff: true,
  },
  'research.reviewed': {
    label: 'Research reviewed',
    description: 'A research item you submitted was reviewed or verified.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'ai.proposal_decided': {
    label: 'AI proposal decided',
    description: 'Someone confirmed or declined an action you proposed through JAVE AI.',
    severity: 'info',
    channels: [],
  },
  'event.updated': {
    label: 'Event update',
    description: 'An event you responded to was rescheduled or cancelled.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'event.waitlist': {
    label: 'Waitlist',
    description: 'A spot opened for you at an event you waitlisted for.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'referral.validated': {
    label: 'Referral validated',
    description: 'Someone you referred passed retention and became a valid referral.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'moderation.notice': {
    label: 'Moderation notice',
    description: 'A moderation action concerning your account.',
    severity: 'important',
    // Inbox only: the Discord DM is sent by the discord.moderation.apply job,
    // which orders it before a kick or ban.
    channels: [],
  },
  'moderation.sync_failed': {
    label: 'Moderation sync failed',
    description: 'A moderation action could not be applied in Discord.',
    severity: 'important',
    channels: ['discord_dm'],
    staff: true,
  },
  'contribution.updated': {
    label: 'Contribution update',
    description: 'A contribution of yours was recorded, verified or rejected.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'integration.alert': {
    label: 'Integration alert',
    description: 'An integration or outbound webhook needs attention.',
    severity: 'important',
    channels: ['discord_dm'],
    staff: true,
  },
  'ticket.attention': {
    label: 'Ticket needs attention',
    description: 'A high-priority ticket was opened or missed its response target.',
    severity: 'important',
    channels: ['discord_dm'],
    staff: true,
  },
  'trial.update': {
    label: 'Trial update',
    description: 'Selection, team assignment, closing or cancellation of a trial you joined.',
    severity: 'notice',
    channels: ['discord_dm'],
  },
  'trial.attention': {
    label: 'Trial needs attention',
    description: 'A scheduled trial start was skipped and needs a decision.',
    severity: 'important',
    channels: ['discord_dm'],
    staff: true,
  },
  'trial.evaluation_requested': {
    label: 'Trial evaluation',
    description: 'A trial closed submissions and is ready for evaluation.',
    severity: 'notice',
    channels: ['discord_dm'],
    staff: true,
  },
  'verification.assigned': {
    label: 'Verification assigned',
    description: 'A verification was assigned to you for review.',
    severity: 'notice',
    channels: ['discord_dm'],
    staff: true,
  },
} as const satisfies Record<string, NotificationTypeDefinition>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];
