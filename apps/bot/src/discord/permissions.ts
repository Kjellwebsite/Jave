import { GatewayIntentBits, OAuth2Scopes, PermissionFlagsBits } from 'discord.js';

/**
 * Least-privilege Discord configuration. JAVE never requests Administrator.
 * Each permission is justified; DEPLOYMENT.md mirrors this table.
 */
export const REQUIRED_PERMISSIONS = {
  ViewChannel: 'Read channels JAVE operates in.',
  SendMessages: 'Post cards, announcements and alerts.',
  SendMessagesInThreads: 'Reply inside ticket threads.',
  EmbedLinks: 'Render embeds.',
  AttachFiles: 'Upload ticket transcripts.',
  ReadMessageHistory: 'Edit its own cards; ticket transcripts.',
  ManageRoles:
    'Sync JAVE roles to Discord roles and apply quarantine (bot role must sit above managed roles).',
  ManageChannels: 'Create private trial team channels.',
  CreatePrivateThreads: 'Open private ticket threads.',
  ManageThreads: 'Lock and archive ticket threads.',
  ManageMessages: 'Delete automod-flagged messages.',
  ModerateMembers: 'Time out members (moderation cases, automod).',
  KickMembers: 'Kick members (moderation cases).',
  BanMembers: 'Ban/unban members (moderation cases).',
  ManageGuild: 'List invites for referral attribution.',
  ManageEvents: 'Create Discord scheduled events for JAVELIN events.',
} as const satisfies Partial<Record<keyof typeof PermissionFlagsBits, string>>;

export const REQUIRED_PERMISSION_BITS = (
  Object.keys(REQUIRED_PERMISSIONS) as (keyof typeof REQUIRED_PERMISSIONS)[]
).reduce((acc, name) => acc | PermissionFlagsBits[name], 0n);

/**
 * Gateway intents. GuildMembers and MessageContent are privileged and must be
 * enabled in the Discord developer portal (Bot → Privileged Gateway Intents).
 */
export const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers, // joins/leaves, role sync (privileged)
  GatewayIntentBits.GuildMessages, // automod, ticket transcripts
  GatewayIntentBits.MessageContent, // automod, ticket transcripts (privileged)
  GatewayIntentBits.GuildInvites, // referral attribution
  GatewayIntentBits.GuildModeration, // ban sync
] as const;

export function inviteUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands].join(' '),
    permissions: REQUIRED_PERMISSION_BITS.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
