'use server';

import { revalidatePath } from 'next/cache';
import { isUuid, markNotificationsRead } from '@jave/core';
import type { ActionState } from '@/lib/action-state';
import { formString } from '@/lib/form-data';
import { runAction } from '@/server/actions';

/** Marks one notification read. Scoped to the caller's own inbox by the service. */
export async function markReadAction(data: FormData): Promise<void> {
  const id = formString(data, 'id');
  await runAction('notifications.mark_read', async (ctx) => {
    if (!isUuid(id)) return 'Nothing to mark.';
    await markNotificationsRead(ctx, [id]);
    revalidatePath('/', 'layout');
    return 'Marked read.';
  });
}

export async function markAllReadAction(_: ActionState, _data: FormData): Promise<ActionState> {
  return runAction('notifications.mark_all_read', async (ctx) => {
    const count = await markNotificationsRead(ctx, 'all');
    revalidatePath('/', 'layout');
    return count === 0 ? 'Inbox already clear.' : `${count} marked read.`;
  });
}
