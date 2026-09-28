import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { privacy, type UserActor } from '@jave/core';
import { readSmallForm } from '../download';
import { memberExportResponse } from './export';

const KIT_TIMEOUT = 180_000;

describe('member data export route', () => {
  let kit: TestKit;
  let member: UserActor;
  let core: UserActor;
  let founder: UserActor;

  beforeAll(async () => {
    kit = await createTestKit();
    member = await kit.member({ roles: ['member'], username: 'exporter' });
    core = await kit.member({ roles: ['core'] });
    founder = await kit.member({ roles: ['founder'] });
  }, KIT_TIMEOUT);
  afterAll(async () => {
    await kit.close();
  });

  it('downloads your own data as an inert JSON attachment', async () => {
    const response = await memberExportResponse(kit.as(member), {});
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="jave-export-exporter-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const body = (await response.json()) as privacy.MemberExport;
    expect(body.subject.userId).toBe(member.userId);
  });

  it('answers refusals with a status and a message, never a stack', async () => {
    const forbidden = await memberExportResponse(kit.as(core), {
      memberId: member.memberId!,
      reason: 'DSR',
    });
    expect(forbidden.status).toBe(403);
    const missingReason = await memberExportResponse(kit.as(founder), {
      memberId: member.memberId!,
    });
    expect(missingReason.status).toBe(400);
    expect(await missingReason.json()).toMatchObject({ message: 'Give a reason.' });
    const malformed = await memberExportResponse(kit.as(founder), { memberId: 'not-a-uuid' });
    expect(malformed.status).toBe(404);
  });

  it(
    'rate-limits per requester',
    async () => {
      const limited = await createTestKit();
      try {
        const actor = await limited.member({ roles: ['member'] });
        for (let i = 0; i < privacy.EXPORT_RATE_LIMIT; i++) {
          expect((await memberExportResponse(limited.as(actor), {})).status).toBe(200);
        }
        const refused = await memberExportResponse(limited.as(actor), {});
        expect(refused.status).toBe(429);
      } finally {
        await limited.close();
      }
    },
    KIT_TIMEOUT,
  );
});

describe('readSmallForm', () => {
  const post = (body: string, length: string | null) =>
    new Request('https://jave.test/me/export', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(length === null ? {} : { 'content-length': length }),
      },
    });

  it('reads a small form', async () => {
    const form = await readSmallForm(post('reason=DSR-1', '12'), 2048);
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get('reason')).toBe('DSR-1');
  });

  it('BREAK: refuses missing, oversized or lying lengths before parsing', async () => {
    expect(((await readSmallForm(post('a=1', null), 2048)) as Response).status).toBe(413);
    expect(((await readSmallForm(post('a=1', '5000'), 2048)) as Response).status).toBe(413);
    expect(((await readSmallForm(post('a=1', '-1'), 2048)) as Response).status).toBe(413);
  });
});
