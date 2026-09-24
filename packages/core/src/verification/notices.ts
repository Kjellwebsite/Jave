import type { ServiceContext } from '../kernel/context';
import { notify } from '../notifications/notifications.service';
import { assignedNoticeCopy, type SubjectNotice, subjectNoticeCopy } from './copy';
import { verificationReference } from './rules';
import type { LoadedVerification } from './types';

/**
 * Tell the subject a verification reached a final state
 * (approved / rejected / revoked / expired). When another service already
 * sent the subject a DM about the same change (e.g. rank.updated), the
 * notice goes to the dashboard inbox only.
 */
export async function notifySubject(
  tx: ServiceContext,
  verification: LoadedVerification,
  notice: SubjectNotice,
  options: { dmAlreadySent?: boolean } = {},
): Promise<string | null> {
  const copy = subjectNoticeCopy(verification, notice);
  return notify(tx, {
    recipientUserId: verification.subjectUserId,
    type: 'verification.completed',
    title: copy.title,
    body: copy.body,
    data: {
      verificationId: verification.id,
      reference: verificationReference(verification.number),
      status: notice.kind,
    },
    dedupeKey: `verification:${verification.id}:${notice.kind}`,
    channels: options.dmAlreadySent ? [] : undefined,
  });
}

/** Tell a verifier a verification was assigned to them. */
export async function notifyAssignee(
  tx: ServiceContext,
  verification: LoadedVerification,
  verifierUserId: string,
): Promise<string | null> {
  const copy = assignedNoticeCopy(verification);
  return notify(tx, {
    recipientUserId: verifierUserId,
    type: 'verification.assigned',
    title: copy.title,
    body: copy.body,
    data: {
      verificationId: verification.id,
      reference: verificationReference(verification.number),
    },
    dedupeKey: `verification:${verification.id}:assigned:${verifierUserId}:${tx.clock.now().getTime()}`,
  });
}
