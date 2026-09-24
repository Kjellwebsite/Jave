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
