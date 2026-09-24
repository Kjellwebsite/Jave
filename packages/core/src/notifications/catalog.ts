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
  'achievement.updated': {
    label: 'Achievement updated',
    description: 'One of your achievements was verified or revoked.',
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
} as const satisfies Record<string, NotificationTypeDefinition>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];
