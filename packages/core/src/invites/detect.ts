/**
 * Invite-use detection. Discord does not tell a bot which invite a new member
 * used; the bot compares invite use counts captured before and after the join.
 * This module is pure so the rule can be tested exhaustively.
 */

export interface InviteUsage {
  code: string;
  uses: number;
  /** Null or 0 = unlimited. A consumed last use makes Discord delete the invite. */
  maxUses?: number | null;
  /** The guild's vanity URL. */
  vanity?: boolean;
}

export type UnknownInviteReason = 'no_change' | 'ambiguous';

export type InviteDetection =
  | { method: 'invite'; code: string }
  | { method: 'vanity'; code: string }
  | { method: 'unknown'; code: null; reason: UnknownInviteReason };

interface UsageChange {
  code: string;
  delta: number;
  vanity: boolean;
}

function indexByCode(list: readonly InviteUsage[]): Map<string, InviteUsage> {
  const map = new Map<string, InviteUsage>();
  for (const entry of list) map.set(entry.code, entry);
  return map;
}

/** True when `usage` had exactly one use left, so one more use deletes it. */
function lastUseConsumed(usage: InviteUsage): boolean {
  return typeof usage.maxUses === 'number' && usage.maxUses > 0 && usage.uses + 1 === usage.maxUses;
}

function collectChanges(
  before: Map<string, InviteUsage>,
  after: Map<string, InviteUsage>,
): UsageChange[] {
  const changes: UsageChange[] = [];
  for (const [code, next] of after) {
    const previous = before.get(code);
    const delta = next.uses - (previous?.uses ?? 0);
    // An invite first seen now counts as changed only if it has been used.
    if (delta !== 0) {
      changes.push({ code, delta, vanity: Boolean(next.vanity ?? previous?.vanity) });
    }
  }
  for (const [code, previous] of before) {
    if (after.has(code)) continue;
    // Disappeared: either its last use was just consumed (a candidate), or it was
    // deleted/expired — which says nothing about this join.
    if (lastUseConsumed(previous)) {
      changes.push({ code, delta: 1, vanity: Boolean(previous.vanity) });
    }
  }
  return changes;
}

/**
 * Which invite did the member who just joined use?
 *
 * Exactly one invite must have changed, and by exactly +1. Anything else —
 * no change, several invites changed, a jump of more than one (missed events),
 * or a decrease — is reported as unknown rather than guessed.
 */
export function detectUsedInvite(
  before: readonly InviteUsage[],
  after: readonly InviteUsage[],
): InviteDetection {
  const changes = collectChanges(indexByCode(before), indexByCode(after));
  if (changes.length === 0) return { method: 'unknown', code: null, reason: 'no_change' };
  const [only] = changes;
  if (changes.length > 1 || !only || only.delta !== 1) {
    return { method: 'unknown', code: null, reason: 'ambiguous' };
  }
  return only.vanity
    ? { method: 'vanity', code: only.code }
    : { method: 'invite', code: only.code };
}
