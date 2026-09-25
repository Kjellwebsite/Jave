import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { projects, securityEvents } from '@jave/database';
import { loadOverviewMetrics } from './overview';

let kit: TestKit;

beforeEach(async () => {
  kit = await createTestKit();
});

afterEach(async () => {
  await kit.close();
});

describe('overview metrics', () => {
  it('works on an empty organization', async () => {
    const metrics = await loadOverviewMetrics(kit.system);
    expect(metrics).toHaveLength(8);
    expect(metrics.every((metric) => metric.value === 0)).toBe(true);
  });

  it('counts real rows', async () => {
    const owner = await kit.member({ roles: ['verified'] });
    await kit.member();
    await kit.db
      .insert(projects)
      .values({ slug: 'p1', title: 'P1', ownerMemberId: owner.memberId!, status: 'shipped' });
    await kit.db
      .insert(securityEvents)
      .values({ riskScore: 50, trigger: 'spam_rate', evidence: { signals: [] } });
    const metrics = Object.fromEntries(
      (await loadOverviewMetrics(kit.system)).map((m) => [m.key, m.value]),
    );
    expect(metrics).toMatchObject({
      membersPresent: 2,
      joinedRecently: 2,
      projectsShipped: 1,
      openSecurityEvents: 1,
    });
  });

  it('BREAK: computes only the metrics the actor may see', async () => {
    const member = await kit.member({ roles: ['member'] });
    const keys = (await loadOverviewMetrics(kit.as(member))).map((metric) => metric.key);
    expect(keys).not.toContain('openApplications');
    expect(keys).not.toContain('openTickets');
    expect(keys).not.toContain('openSecurityEvents');
    expect(keys).toContain('membersPresent');
    const applicant = await kit.member({ roles: ['applicant'] });
    expect(await loadOverviewMetrics(kit.as(applicant))).toEqual([]);
  });
});
