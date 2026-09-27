/** Normalized gateway events, independent of discord.js, so features are testable. */

export interface IncomingMessage {
  id: string;
  channelId: string;
  guildId: string | null;
  /** Parent channel when the message is inside a thread. */
  parentChannelId: string | null;
  isThread: boolean;
  author: {
    id: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
    bot: boolean;
  };
  authorRoleIds: readonly string[];
  content: string;
  mentionCount: number;
  mentionsEveryone: boolean;
  attachments: { name: string; url: string; size: number; contentType: string | null }[];
  createdAt: Date;
  url: string;
}

export interface MessageUpdate {
  id: string;
  channelId: string;
  guildId: string | null;
  content: string;
  editedAt: Date;
  /**
   * The edited message's author (Discord's update carries the full message).
   * Optional so synthetic updates that do not need it stay valid.
   */
  author?: IncomingMessage['author'];
  /** Set when a webhook posted the message (its author is not a user). */
  webhookId?: string | null;
  /** False for updates Discord makes itself (link embeds unfurling); true for real edits. */
  contentEdited?: boolean;
  mentionCount?: number;
  mentionsEveryone?: boolean;
}

export interface MessageDeletion {
  id: string;
  channelId: string;
  guildId: string | null;
}

export interface JoinedMember {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  bot: boolean;
  joinedAt: Date;
}
