import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLogs } from '@jave/database';
import { createTestKit, type TestKit } from '../testing';
import { EXPORT_FORMAT, EXPORT_RATE_LIMIT } from './constants';
import { exportFileName, exportMemberData } from './export.service';
import { buildFootprint, type Footprint, NOVA } from './test-support';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

describe('privacy: export', () => {
  let kit: TestKit;
  let f: Footprint;

  beforeEach(async () => {
    kit = await createTestKit();
    f = await buildFootprint(kit);
  });
  afterEach(async () => {
    await kit.close();
  });

  it('gives a member their own data, as they see it in JAVE', async () => {
    const document = await exportMemberData(kit.as(f.nova));
    expect(document).toMatchObject({ format: EXPORT_FORMAT, version: 1 });
    expect(document.subject).toMatchObject({ userId: f.nova.userId, memberId: f.nova.memberId });
    const { sections } = document;
    expect(sections.account.profile).toMatchObject({
      displayName: NOVA.displayName,
      bio: 'QZ-BIO I build tools for schools.',
    });
    expect(sections.account.linkedAccounts).toEqual([
      expect.objectContaining({ provider: 'github', username: NOVA.github }),
    ]);
    expect(sections.applications[0]).toMatchObject({
      motivation: expect.stringContaining('QZ-MOTIVATION'),
      references: expect.stringContaining('QZ-REFERENCES'),
      messageFromReviewers: `Welcome, ${NOVA.displayName}.`,
      status: 'accepted',
    });
    expect(sections.applications[0]!.timeline.length).toBeGreaterThan(1);
    expect(sections.capability!.evidence[0]).toMatchObject({ title: 'QZ-EVIDENCE scheduler' });
    expect(sections.work!.missions[0]).toMatchObject({
      submission: expect.stringContaining('QZ-MISSION'),
    });
    expect(sections.work!.contributions[0]).toMatchObject({
      title: expect.stringContaining('QZ-CONTRIBUTION'),
    });
    expect(sections.moderation).toEqual([expect.objectContaining({ action: 'warn' })]);
    expect(sections.notifications.length).toBeGreaterThan(0);
    // The ticket conversation she saw, and nothing staff wrote only for staff.
    const [ticket] = sections.support;
    expect(ticket!.subject).toBe('QZ-SUBJECT build server access');
    expect(ticket!.messages.map((m) => m.body)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('QZ-THREADMSG'),
        `Done, ${NOVA.displayName}.`,
      ]),
    );
    expect(ticket!.messages.find((m) => m.body.includes('QZ-THREADMSG'))!.from).toBe('you');

    const text = JSON.stringify(document);
    // Staff-only writing is withheld, and counted.
    expect(text).not.toContain('has strong references'); // application review note
    expect(text).not.toContain('is reliable'); // staff note
    expect(text).not.toContain('writes clean code'); // evaluator notes
    expect(text).not.toContain('checks out'); // internal decision reason
    expect(text).not.toContain('team first'); // ticket internal note
    // Nobody else's private data.
    expect(text).not.toContain('TEAMMATE-BIO');
    // Secrets never: no session token hashes, no IP hashes.
    expect(text).not.toMatch(/tokenHash|ipHash/);
    const withheld = Object.fromEntries(document.withheld.map((w) => [w.category, w.count]));
    expect(withheld).toMatchObject({
      applicationReviews: 1,
      staffNotes: 1,
      evaluatorNotes: 1,
    });
    expect(Object.keys(withheld)).not.toContain('adversarial');
  });

  it('is audited and rate-limited per requester', async () => {
    for (let i = 0; i < EXPORT_RATE_LIMIT; i++) await exportMemberData(kit.as(f.nova));
    await expect(exportMemberData(kit.as(f.nova))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const audits = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'privacy.exported'), eq(auditLogs.targetId, f.nova.userId)));
    expect(audits).toHaveLength(EXPORT_RATE_LIMIT);
    expect(audits[0]!.context).toMatchObject({ self: true });
  });

  it('lets founders export someone else’s data for a request, with a reason', async () => {
    await expect(
      exportMemberData(kit.as(f.core), { memberId: f.nova.memberId!, reason: 'DSR' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      exportMemberData(kit.as(f.teammate), { memberId: f.nova.memberId! }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      exportMemberData(kit.as(f.founder), { memberId: f.nova.memberId! }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const document = await exportMemberData(kit.as(f.founder), {
      memberId: f.nova.memberId!,
      reason: 'Data-subject request DSR-9.',
    });
    expect(document.subject.userId).toBe(f.nova.userId);
    expect(document.sections.account.profile?.displayName).toBe(NOVA.displayName);
    const [audit] = await kit.db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'privacy.exported'), eq(auditLogs.actorUserId, f.founder.userId)),
      );
    expect(audit!.context).toMatchObject({ self: false, reason: 'Data-subject request DSR-9.' });
  });

  it('names the file after the handle and date', async () => {
    const document = await exportMemberData(kit.as(f.nova));
    expect(exportFileName(document)).toMatch(/^jave-export-novaquill-\d{4}-\d{2}-\d{2}\.json$/);
    expect(
      exportFileName({
        subject: { ...document.subject, handle: '../x"y' },
        generatedAt: document.generatedAt,
      }),
    ).toMatch(/^jave-export-xy-/);
  });
});
