import type { ServiceContext } from '../kernel/context';
import { DisabledError } from '../kernel/errors';
import { authorize } from '../permissions/authorize';
import { getSettings } from '../settings/settings.service';

/**
 * Every analytics read: canViewAnalytics (staff: operations and above), and
 * the feature switch settings.analytics.enabled.
 */
export async function authorizeAnalytics(ctx: ServiceContext, target: string): Promise<void> {
  await authorize(ctx, 'canViewAnalytics', { type: 'analytics', id: target });
  const settings = await getSettings(ctx, 'analytics');
  if (!settings.enabled) throw new DisabledError('Analytics');
}
