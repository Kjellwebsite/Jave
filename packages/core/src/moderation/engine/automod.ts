import type { securityTrigger } from '@jave/database';
import type { OrgRole } from '../../permissions/roles';
import type { Settings } from '../../settings/schemas';
import {
  DUPLICATE_MIN_LENGTH,
  DUPLICATE_WINDOW_FACTOR,
  MAX_RECENT_MESSAGES,
  MAX_SCAN_CHARS,
} from '../constants';
import {
  extractInvites,
  extractLinks,
  findDomainMatch,
  FIRST_PARTY_DOMAINS,
  isInviteLink,
  lookalikeOf,
  PROTECTED_DOMAINS,
} from './links';
import { foldConfusables, normalizeForComparison, stripInvisible } from './normalize';
import {
  type AutomodAction,
  decideAction,
  MESSAGE_SIGNAL_WEIGHTS,
  type RiskModifier,
  riskModifiers,
  type RiskSignal,
  scoreRisk,
  SEVERE_MULTIPLE,
  type SignalKey,
  signalDetail,
} from './risk';

export type SecurityTriggerKey = (typeof securityTrigger.enumValues)[number];
export type ModerationSettings = Settings<'moderation'>;

export interface RecentMessage {
  content: string;
  at: Date;
}

export interface AutomodInput {
  content: string;
  /** Distinct user + role mentions in the message. */
  mentionCount: number;
  /** Discord's mention_everyone flag (the text is also scanned for @everyone / @here). */
  mentionsEveryone?: boolean;
  /** The author's JAVE roles. */
  authorRoles: readonly OrgRole[];
  accountAgeDays: number | null;
  /** Minutes since the author joined the server (join-context modifier). */
  memberAgeMinutes?: number | null;
  /** The author's earlier messages (not including this one). Older entries are ignored. */
  recent: readonly RecentMessage[];
  now: Date;
  settings: ModerationSettings;
  /** Invite codes that belong to this server (always allowed). */
  ownInviteCodes: readonly string[];
  /** Caller-level exemption (e.g. an exempt channel). Role exemptions come from settings. */
  exempt?: boolean;
  raidMode?: boolean;
  /** Accounts younger than this many days are "new" (settings.security.suspiciousAccountAgeDays). */
  newAccountDays?: number;
}

export interface AutomodEvaluation {
  signals: RiskSignal[];
  modifiers: RiskModifier[];
  riskScore: number;
  action: AutomodAction;
  /** Dominant violation, mapped to the security-event trigger. Null when clean. */
  trigger: SecurityTriggerKey | null;
  exempt: boolean;
}

const TRIGGER_FOR_SIGNAL: Partial<Record<SignalKey, SecurityTriggerKey>> = {
  spam_rate: 'spam_rate',
  duplicate_content: 'duplicate_content',
  mention_spam: 'mention_spam',
  everyone_mention: 'mention_spam',
  blocked_link: 'blocked_link',
  unlisted_link: 'blocked_link',
  lookalike_domain: 'blocked_link',
  obfuscated_link: 'blocked_link',
  foreign_invite: 'foreign_invite',
};

const EVERYONE_PATTERN = /@(?:everyone|here)\b/i;
const MAX_LISTED_ITEMS = 3;
const MS_PER_SECOND = 1000;

function listDetail(items: readonly string[]): string {
  const unique = [...new Set(items)];
  const shown = unique.slice(0, MAX_LISTED_ITEMS).join(', ');
  const more = unique.length > MAX_LISTED_ITEMS ? ` +${unique.length - MAX_LISTED_ITEMS}` : '';
  return signalDetail(`${shown}${more}`);
}

function usableRecent(input: AutomodInput): RecentMessage[] {
  const now = input.now.getTime();
  return input.recent
    .filter((m) => m.at instanceof Date && Number.isFinite(m.at.getTime()) && m.at.getTime() <= now)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, MAX_RECENT_MESSAGES);
}

function withinSeconds(messages: readonly RecentMessage[], now: Date, seconds: number) {
  const cutoff = now.getTime() - seconds * MS_PER_SECOND;
  return messages.filter((m) => m.at.getTime() > cutoff);
}

function rateSignals(recent: readonly RecentMessage[], input: AutomodInput): RiskSignal[] {
  const { maxMessages, windowSeconds } = input.settings.spam;
  const count = withinSeconds(recent, input.now, windowSeconds).length + 1;
  if (count <= maxMessages) return [];
  const severe = count >= maxMessages * SEVERE_MULTIPLE;
  return [
    {
      key: 'spam_rate',
      weight: severe ? MESSAGE_SIGNAL_WEIGHTS.spam_rate_severe : MESSAGE_SIGNAL_WEIGHTS.spam_rate,
      detail: `${count} messages in ${windowSeconds}s (limit ${maxMessages})`,
    },
  ];
}

function duplicateSignals(
  content: string,
  recent: readonly RecentMessage[],
  input: AutomodInput,
): RiskSignal[] {
  const normalized = normalizeForComparison(content);
  if (normalized.length < DUPLICATE_MIN_LENGTH) return [];
  const { windowSeconds, duplicateThreshold } = input.settings.spam;
  const windowed = withinSeconds(recent, input.now, windowSeconds * DUPLICATE_WINDOW_FACTOR);
  const count =
    windowed.filter(
      (m) => normalizeForComparison(m.content.slice(0, MAX_SCAN_CHARS)) === normalized,
    ).length + 1;
  if (count < duplicateThreshold) return [];
  const severe = count >= duplicateThreshold * SEVERE_MULTIPLE;
  return [
    {
      key: 'duplicate_content',
      weight: severe
        ? MESSAGE_SIGNAL_WEIGHTS.duplicate_content_severe
        : MESSAGE_SIGNAL_WEIGHTS.duplicate_content,
      detail: `same message ${count}× in ${windowSeconds * DUPLICATE_WINDOW_FACTOR}s`,
    },
  ];
}

function mentionSignals(content: string, input: AutomodInput): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const mentions = Number.isFinite(input.mentionCount) ? Math.max(0, input.mentionCount) : 0;
  const max = input.settings.maxMentions;
  if (mentions > max) {
    const severe = mentions >= max * SEVERE_MULTIPLE;
    signals.push({
      key: 'mention_spam',
      weight: severe
        ? MESSAGE_SIGNAL_WEIGHTS.mention_spam_severe
        : MESSAGE_SIGNAL_WEIGHTS.mention_spam,
      detail: `${mentions} mentions (limit ${max})`,
    });
  }
  const everyone = EVERYONE_PATTERN.test(
    foldConfusables(stripInvisible(content.normalize('NFKC'))),
  );
  if (input.mentionsEveryone || everyone) {
    signals.push({
      key: 'everyone_mention',
      weight: MESSAGE_SIGNAL_WEIGHTS.everyone_mention,
      detail: '@everyone / @here attempt',
    });
  }
  return signals;
}

function linkAndInviteSignals(content: string, input: AutomodInput): RiskSignal[] {
  const { links: linkRules, blockForeignInvites } = input.settings;
  const signals: RiskSignal[] = [];
  let obfuscatedViolation = false;

  if (linkRules.mode !== 'off') {
    const blocked: string[] = [];
    const unlisted: string[] = [];
    const lookalikes: string[] = [];
    const protectedDomains = [
      ...PROTECTED_DOMAINS,
      ...linkRules.allowlist.filter((p) => !p.startsWith('*.')),
    ];
    for (const link of extractLinks(content)) {
      if (isInviteLink(link)) continue;
      const imitated = lookalikeOf(link, protectedDomains);
      let flagged = false;
      if (imitated) {
        lookalikes.push(`${link.displayHost} (imitates ${imitated})`);
        flagged = true;
      }
      if (findDomainMatch(link.host, linkRules.denylist, 'deny')) {
        blocked.push(link.host);
        flagged = true;
      } else if (
        linkRules.mode === 'allowlist' &&
        !imitated &&
        !findDomainMatch(link.host, linkRules.allowlist, 'allow') &&
        !findDomainMatch(link.host, FIRST_PARTY_DOMAINS, 'allow')
      ) {
        unlisted.push(link.host);
        flagged = true;
      }
      if (flagged && link.obfuscated) obfuscatedViolation = true;
    }
    if (lookalikes.length > 0) {
      signals.push({
        key: 'lookalike_domain',
        weight: MESSAGE_SIGNAL_WEIGHTS.lookalike_domain,
        detail: listDetail(lookalikes),
      });
    }
    if (blocked.length > 0) {
      signals.push({
        key: 'blocked_link',
        weight: MESSAGE_SIGNAL_WEIGHTS.blocked_link,
        detail: listDetail(blocked),
      });
    }
    if (unlisted.length > 0) {
      signals.push({
        key: 'unlisted_link',
        weight: MESSAGE_SIGNAL_WEIGHTS.unlisted_link,
        detail: listDetail(unlisted.map((host) => `${host} (not allowlisted)`)),
      });
    }
  }

  if (blockForeignInvites) {
    const own = new Set(input.ownInviteCodes);
    const foreign = extractInvites(content).filter((invite) => !own.has(invite.code));
    if (foreign.length > 0) {
      signals.push({
        key: 'foreign_invite',
        weight: MESSAGE_SIGNAL_WEIGHTS.foreign_invite,
        detail: listDetail(foreign.map((invite) => `${invite.host}/${invite.code}`)),
      });
      if (foreign.some((invite) => invite.obfuscated)) obfuscatedViolation = true;
    }
  }

  if (obfuscatedViolation) {
    signals.push({
      key: 'obfuscated_link',
      weight: MESSAGE_SIGNAL_WEIGHTS.obfuscated_link,
      detail: 'link disguised to evade filters',
    });
  }
  return signals;
}

function dominantTrigger(signals: readonly RiskSignal[]): SecurityTriggerKey | null {
  let best: RiskSignal | null = null;
  for (const signal of signals) {
    if (!TRIGGER_FOR_SIGNAL[signal.key]) continue;
    if (!best || signal.weight > best.weight) best = signal;
  }
  return best ? (TRIGGER_FOR_SIGNAL[best.key] ?? null) : null;
}

/**
 * Evaluate one message. Pure: the caller supplies the author's recent
 * messages, roles, account age and the moderation settings.
 */
export function evaluateMessage(input: AutomodInput): AutomodEvaluation {
  const { settings } = input;
  const exempt =
    Boolean(input.exempt) || input.authorRoles.some((role) => settings.exemptRoles.includes(role));
  if (!settings.automodEnabled || exempt) {
    return { signals: [], modifiers: [], riskScore: 0, action: 'none', trigger: null, exempt };
  }
  const content = input.content.slice(0, MAX_SCAN_CHARS);
  const recent = usableRecent(input);
  const signals: RiskSignal[] = [
    ...rateSignals(recent, input),
    ...duplicateSignals(content, recent, input),
    ...mentionSignals(content, input),
    ...linkAndInviteSignals(content, input),
  ];
  const modifiers =
    signals.length > 0
      ? riskModifiers({
          accountAgeDays: input.accountAgeDays,
          memberAgeMinutes: input.memberAgeMinutes,
          raidMode: input.raidMode,
          newAccountDays: input.newAccountDays,
        })
      : [];
  const riskScore = scoreRisk(signals, modifiers);
  return {
    signals,
    modifiers,
    riskScore,
    action: decideAction(riskScore, signals.length > 0, settings.quarantineRiskScore),
    trigger: dominantTrigger(signals),
    exempt: false,
  };
}
