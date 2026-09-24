import type { OrgRole } from './roles';

/**
 * Capability catalog. Code paths check capabilities, never role names.
 * Role → capability grants below are the single source of truth.
 */
export const CAPABILITIES = {
  // Members & identity
  canViewMembers: 'List members and view member-visible profiles.',
  canViewPrivateProfiles: 'View staff-only profiles, notes and claims regardless of privacy.',
  canManageMembers: 'Edit member profiles and add staff notes.',
  canAssignRoles: 'Grant or revoke organizational roles below your own.',
  // Ranking & verification
  canModifyRanks: 'Set verified ranks and record evaluator notes.',
  canViewRankHistory: 'View any member’s full rank history.',
  canVerifyMembers: 'Approve or reject verification requests.',
  // Applications
  canViewApplications: 'Read applications, including private references.',
  canReviewApplications: 'Leave reviews and recommendations on applications.',
  canDecideApplications: 'Accept, reject or move applications to interview.',
  // Trials
  canManageTrials: 'Create, schedule, start and close trials; assign teams.',
  canEvaluateTrials: 'Score trial submissions and participants.',
  canManageAdversarial: 'Plan, authorize and observe adversarial roles (staff-only).',
  canAuthorizeAdversarial: 'Authorize an adversarial role before it is briefed.',
  // Missions, projects, events, research
  canManageMissions: 'Create missions and assign them.',
  canVerifyMissions: 'Verify mission submissions.',
  canManageProjects: 'Edit or archive any project.',
  canVerifyContributions: 'Verify contributions.',
  canManageEvents: 'Create and run events and tournaments.',
  canReviewResearch: 'Review and verify research items.',
  // Tickets
  canHandleTickets: 'View, claim and respond to tickets.',
  canManageTickets: 'Transfer, close any ticket, and read internal notes and transcripts.',
  // Moderation & security
  canModerate: 'Warn and time out members; view moderation cases.',
  canKickMembers: 'Kick members.',
  canBanMembers: 'Ban and unban members.',
  canQuarantine: 'Quarantine and release members.',
  canViewSecurityEvents: 'View and triage security events.',
  canManageSecurity: 'Change raid mode and security posture.',
  // Achievements & invites
  canManageAchievements: 'Define achievements.',
  canAwardAchievements: 'Manually award or revoke achievements.',
  canManageCampaigns: 'Manage invite campaigns and referral codes.',
  // Platform
  canViewAnalytics: 'View organizational analytics.',
  canManageIntegrations: 'Configure integrations and webhooks.',
  canUseAI: 'Use JAVE AI features.',
  canConfirmAIActions:
    'Confirm AI-proposed actions (still bounded by the action’s own capability).',
  canBroadcast: 'Send announcements and broadcast notifications.',
  canViewSettings: 'View server settings.',
  canManageSettings: 'Change server settings.',
  canViewAuditLogs: 'Read the audit log.',
  canViewSystemStatus: 'View detailed system diagnostics.',
  canHostGames: 'Host games and game sessions.',
} as const;

export type Capability = keyof typeof CAPABILITIES;

export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as Capability[];

const BASE: Capability[] = ['canViewMembers', 'canUseAI', 'canHostGames'];

const MODERATOR: Capability[] = [
  ...BASE,
  'canModerate',
  'canKickMembers',
  'canQuarantine',
  'canViewSecurityEvents',
  'canHandleTickets',
  'canViewPrivateProfiles',
  'canViewSystemStatus',
];

const OPERATIONS: Capability[] = [
  ...MODERATOR,
  'canManageMembers',
  'canViewRankHistory',
  'canVerifyMembers',
  'canViewApplications',
  'canReviewApplications',
  'canManageTrials',
  'canEvaluateTrials',
  'canManageMissions',
  'canVerifyMissions',
  'canManageProjects',
  'canVerifyContributions',
  'canManageEvents',
  'canReviewResearch',
  'canManageTickets',
  'canAwardAchievements',
  'canViewAnalytics',
  'canConfirmAIActions',
  'canViewSettings',
];

const CORE: Capability[] = [
  ...OPERATIONS,
  'canAssignRoles',
  'canModifyRanks',
  'canDecideApplications',
  'canManageAdversarial',
  'canAuthorizeAdversarial',
  'canBanMembers',
  'canManageSecurity',
  'canManageAchievements',
  'canManageCampaigns',
  'canManageIntegrations',
  'canBroadcast',
  'canManageSettings',
  'canViewAuditLogs',
];

export const ROLE_CAPABILITIES: Record<OrgRole, readonly Capability[]> = {
  founder: CAPABILITY_KEYS,
  core: CORE,
  operations: OPERATIONS,
  moderator: MODERATOR,
  verified: BASE,
  trial: BASE,
  applicant: ['canUseAI'],
  member: BASE,
  supporter: [],
};

/** Capabilities that survive a 'restricted' standing. */
export const RESTRICTED_CAPABILITIES: readonly Capability[] = ['canViewMembers'];

export function capabilitiesForRoles(roles: readonly OrgRole[]): Set<Capability> {
  const out = new Set<Capability>();
  for (const role of roles) for (const capability of ROLE_CAPABILITIES[role]) out.add(capability);
  return out;
}
