import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestKit, type TestKit } from '@jave/core/testing';
import { tickets, type UserActor, updateSettings } from '@jave/core';
import { auditLogs, members } from '@jave/database';
import { BULK_LIMIT } from '@/lib/ticket-view';
import { bulkOutcome, parseTicketIds } from './bulk';
import { listTicketHandlers, peopleNames } from './people';
import {
  activeQuickView,
  filterQuery,
  listInputFor,
  loadQueueCounts,
  loadTicketPerformance,
  parseQueueFilters,
  queueMode,
} from './queue';
import { MAX_EXPORT_BODY_BYTES, readTranscriptForm, transcriptResponse } from './transcript';

const TICKET_CHANNEL = '300000000000000101';
const KIT_TIMEOUT = 180_000;
const UUID = '0b5a3f0e-8d1c-4f47-9e7a-2d6c1b9f4a10';

describe('queue filters', () => {
  it('defaults: handlers get the active queue by deadline, members their own tickets', () => {
    const staff = parseQueueFilters({}, true);
    expect(staff).toMatchObject({ status: 'active', sort: 'sla', offset: 0 });
    expect(queueMode(staff, true)).toBe('handler');
    expect(listInputFor(staff, 'handler')).toMatchObject({
      mine: false,
      status: ['open', 'claimed', 'waiting'],
      sort: 'sla',
    });
    const member = parseQueueFilters({}, false);
    expect(member).toMatchObject({ status: 'all', sort: 'activity' });
    expect(listInputFor(member, queueMode(member, false))).toMatchObject({
      mine: true,
      status: ['open', 'claimed', 'waiting', 'closed', 'archived'],
    });
  });

  it('BREAK: malformed values are dropped, never an error page', () => {
    const filters = parseQueueFilters(
      {
        status: 'deleted',
        category: '<script>',
        priority: ['urgent', 'low'],
        assignee: "' or 1=1 --",
        sla: 'maybe',
        sort: 'random',
        offset: '-5',
        q: 'x'.repeat(500),
      },
      true,
    );
    expect(filters).toEqual({
      q: undefined,
      status: 'active',
      category: undefined,
      priority: 'urgent',
      assignee: undefined,
      sla: undefined,
      sort: 'sla',
      scope: undefined,
      offset: 0,
    });
  });

  it('BREAK: handler-only filters are ignored for members', () => {
    const filters = parseQueueFilters(
      { assignee: UUID, sla: 'missed', sort: 'sla', scope: 'own' },
      false,
    );
    expect(filters).toMatchObject({
      assignee: undefined,
      sla: undefined,
      sort: 'activity',
      scope: undefined,
    });
  });

  it('recognises quick views and omits defaults from links', () => {
    const unassigned = parseQueueFilters({ assignee: 'none', category: 'report' }, true);
    expect(activeQuickView(unassigned, 'handler')).toBe('unassigned');
    expect(filterQuery(unassigned, 'handler')).toEqual({
      q: undefined,
      status: undefined,
      category: 'report',
      priority: undefined,
      assignee: 'none',
      sla: undefined,
      sort: undefined,
      scope: undefined,
    });
    const own = parseQueueFilters({ scope: 'own' }, true);
    expect(queueMode(own, true)).toBe('requester');
    expect(activeQuickView(own, 'requester')).toBe('own');
    expect(activeQuickView(parseQueueFilters({ status: 'open' }, true), 'handler')).toBeNull();
  });
});

describe('bulk selection', () => {
  it('parses a page of unique ticket ids', () => {
    expect(parseTicketIds(`${UUID}, ${UUID},`)).toEqual([UUID]);
  });

  it('BREAK: empty, oversized and malformed selections are refused', () => {
    expect(() => parseTicketIds('')).toThrow('Select at least one ticket.');
    const many = Array.from(
      { length: BULK_LIMIT + 1 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    expect(() => parseTicketIds(many.join(','))).toThrow(`at most ${BULK_LIMIT}`);
    expect(() => parseTicketIds(`${UUID},../../etc`)).toThrow('no longer valid');
  });

  it('reports partial success per ticket and fails only when nothing succeeded', () => {
    expect(
      bulkOutcome('CLAIMED', [
        { ok: true, reference: '#0001' },
        { ok: false, message: 'Already claimed by another handler.' },
      ]),
    ).toEqual({
      ok: true,
      message: 'CLAIMED 1 OF 2 — #0001. 1 refused: Already claimed by another handler.',
    });
    expect(bulkOutcome('CLOSED', [{ ok: false, message: 'Ticket #0002 is closed.' }])).toEqual({
      ok: false,
      message: 'Nothing closed. Ticket #0002 is closed.',
    });
  });
});

describe('ticket read models and transcript export', { timeout: 60_000 }, () => {
  let kit: TestKit;
  let requester: UserActor;
  let stranger: UserActor;
  let moderator: UserActor;
  let manager: UserActor;
  let ticketId: string;

  beforeAll(async () => {
    kit = await createTestKit();
    await updateSettings(kit.system, 'channels', { tickets: TICKET_CHANNEL });
    requester = await kit.member({ roles: ['verified'], username: 'requester' });
    stranger = await kit.member({ roles: ['member'], username: 'stranger' });
    moderator = await kit.member({ roles: ['moderator'], username: 'moderator' });
    manager = await kit.member({ roles: ['operations'], username: 'manager' });
    const opened = await tickets.openTicket(kit.as(requester), {
      category: 'technical',
      priority: 'high',
      subject: 'Deploy fails <b>loudly</b>',
      body: 'Exit code 137 since yesterday.',
    });
    ticketId = opened.id;
    await tickets.claimTicket(kit.as(moderator), { ticketId });
    await tickets.addInternalNote(kit.as(moderator), {
      ticketId,
      body: 'Probably the runner memory limit.',
    });
    await tickets.openTicket(kit.as(stranger), {
      category: 'general',
      subject: 'Another question',
      body: 'Unrelated.',
    });
  }, KIT_TIMEOUT);
  afterAll(async () => {
    await kit.close();
  }, KIT_TIMEOUT);

  it('counts the live queue for handlers only', async () => {
    expect(await loadQueueCounts(kit.as(moderator))).toEqual({
      active: 2,
      unassigned: 1,
      assignedToMe: 1,
      missed: 0,
    });
    expect(await loadQueueCounts(kit.as(requester))).toBeNull();
  });

  it('shows 30-day performance to ticket managers, not to plain handlers', async () => {
    expect(await loadTicketPerformance(kit.as(moderator))).toBeNull();
    const stats = await loadTicketPerformance(kit.as(manager));
    expect(stats?.opened).toBe(2);
  });

  it('lists people who can handle tickets, for handlers only', async () => {
    const people = await listTicketHandlers(kit.as(moderator));
    expect(people.map((person) => person.userId).sort()).toEqual(
      [moderator.userId, manager.userId].sort(),
    );
    expect(await listTicketHandlers(kit.as(requester))).toEqual([]);
    expect(await peopleNames(kit.as(requester), [moderator.userId])).toEqual(new Map());
  });

  it('BREAK: a restricted handler is no longer offered as a transfer target', async () => {
    const benched = await kit.member({ roles: ['moderator'], username: 'benched' });
    await kit.db
      .update(members)
      .set({ standing: 'restricted' })
      .where(eq(members.id, benched.memberId!));
    const people = await listTicketHandlers(kit.as(manager));
    expect(people.map((person) => person.userId)).not.toContain(benched.userId);
  });

  it('downloads the requester transcript as an inert attachment, without internal notes', async () => {
    const response = await transcriptResponse(kit.as(requester), {
      ticketId,
      format: 'html',
      includeInternal: false,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="ticket-0001.html"',
    );
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const html = await response.text();
    expect(html).toContain('Deploy fails &lt;b&gt;loudly&lt;/b&gt;');
    expect(html).not.toContain('runner memory limit');
  });

  it('gives managers the internal record in Markdown', async () => {
    const response = await transcriptResponse(kit.as(manager), {
      ticketId,
      format: 'markdown',
      includeInternal: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="ticket-0001-internal.md"',
    );
    expect(await response.text()).toContain('runner memory limit');
  });

  it('BREAK: the requester cannot export internal notes; strangers and plain handlers get 404', async () => {
    const internal = await transcriptResponse(kit.as(requester), {
      ticketId,
      format: 'html',
      includeInternal: true,
    });
    expect(internal.status).toBe(403);
    for (const actor of [stranger, moderator]) {
      const hidden = await transcriptResponse(kit.as(actor), {
        ticketId,
        format: 'html',
        includeInternal: false,
      });
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toEqual({ message: 'Ticket not found.' });
    }
    const denials = await kit.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.denied'), eq(auditLogs.targetId, ticketId)));
    expect(denials.length).toBeGreaterThanOrEqual(3);
  });

  it('BREAK: malformed ids and formats never reach core', async () => {
    const ctx = kit.as(manager);
    expect(
      (await transcriptResponse(ctx, { ticketId: '../1', format: 'html', includeInternal: false }))
        .status,
    ).toBe(404);
    expect(
      (await transcriptResponse(ctx, { ticketId, format: 'pdf', includeInternal: false })).status,
    ).toBe(400);
  });

  it('BREAK: the export form refuses oversized and unframed bodies before parsing', async () => {
    const post = (body: string, headers: Record<string, string>) =>
      new Request('http://localhost/tickets/x/transcript', { method: 'POST', body, headers });
    const tooLarge = await readTranscriptForm(
      post('format=html', {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(MAX_EXPORT_BODY_BYTES + 1),
      }),
    );
    expect(tooLarge).toBeInstanceOf(Response);
    expect((tooLarge as Response).status).toBe(413);
    const ok = await readTranscriptForm(
      post('format=markdown&internal=on', {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '27',
      }),
    );
    expect(ok).toEqual({ format: 'markdown', includeInternal: true });
  });
});
