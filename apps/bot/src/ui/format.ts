import { GLYPH } from './theme';

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Neutralize mention syntax in user-provided text rendered by the bot. */
export function neutralizeMentions(text: string): string {
  return text
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/<@([!&]?)(\d{17,20})>/g, '<@​$1$2>')
    .replace(/<#(\d{17,20})>/g, '<#​$1>');
}

/** Escape Discord markdown in user-provided text. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_`~|>#[\]()-])/g, '\\$1');
}

/** Safe rendering of untrusted user text inside bot messages. */
export function userText(text: string | null | undefined, max = 1024): string {
  if (!text) return '';
  return clip(neutralizeMentions(escapeMarkdown(text)), max);
}

/** Discord timestamp markup. */
export function discordTime(
  date: Date,
  style: 'R' | 'f' | 'F' | 'd' | 'D' | 't' | 'T' = 'R',
): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export type RankStatus = 'verified' | 'claimed' | 'unknown';

/** "S ✓", "A ◇", "—" — rank with its verification glyph. */
export function rankMark(rank: string | null, status: RankStatus): string {
  if (!rank || status === 'unknown') return GLYPH.unknown;
  return status === 'verified' ? `**${rank}** ${GLYPH.verified}` : `${rank} ${GLYPH.claimed}`;
}

export function statusLabel(status: RankStatus): string {
  return status.toUpperCase();
}

export function spaced(text: string): string {
  return text.toUpperCase();
}

/** Monospace aligned rows for technical readouts (inside a code block). */
export function alignRows(rows: [string, string][], gap = 2): string {
  const width = Math.max(...rows.map(([label]) => label.length)) + gap;
  return rows.map(([label, value]) => `${label.padEnd(width)}${value}`).join('\n');
}
