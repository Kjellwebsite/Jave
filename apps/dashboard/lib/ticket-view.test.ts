import { describe, expect, it } from 'vitest';
import type { Capability } from '@jave/core';
import {
  formatBytes,
  formatDuration,
  slaReadout,
  type TicketActionInput,
  ticketControls,
  type TicketStatus,
} from './ticket-view';

const MINUTE = 60_000;
const OPENED = new Date('2026-09-01T10:00:00.000Z');

function at(minutesAfterOpening: number): Date {
  return new Date(OPENED.getTime() + minutesAfterOpening * MINUTE);
}

describe('formatDuration', () => {
  it('reads compactly at every scale', () => {
    expect(formatDuration(20_000)).toBe('<1m');
    expect(formatDuration(42 * MINUTE)).toBe('42m');
    expect(formatDuration(60 * MINUTE)).toBe('1h');
    expect(formatDuration(192 * MINUTE)).toBe('3h 12m');
    expect(formatDuration(24 * 60 * MINUTE)).toBe('1d');
    expect(formatDuration((52 * 60 + 5) * MINUTE)).toBe('2d 4h');
    expect(formatDuration(-8 * MINUTE)).toBe('8m');
  });

  it('formats attachment sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('slaReadout', () => {
  const open = { createdAt: OPENED, status: 'open' as TicketStatus };
  const pending = { state: 'pending' as const, dueAt: at(60), firstResponseMinutes: null };

  it('counts down calmly, warns in the last quarter, and turns red once overdue', () => {
    expect(slaReadout(pending, open, at(18))).toEqual({
      label: 'Due in 42m',
      tone: 'neutral',
      ticking: true,
    });
    expect(slaReadout(pending, open, at(50)).tone).toBe('warning');
    expect(slaReadout(pending, open, at(68))).toEqual({
      label: 'Overdue 8m',
      tone: 'danger',
      ticking: true,
    });
  });

  it('shows settled outcomes without ticking', () => {
    expect(
      slaReadout({ state: 'met', dueAt: at(60), firstResponseMinutes: 14.5 }, open, at(90)),
    ).toEqual({ label: 'Met in 14m', tone: 'success', ticking: false });
    expect(slaReadout({ ...pending, state: 'breached' }, open, at(90)).label).toBe('Missed');
    expect(
      slaReadout({ state: 'none', dueAt: null, firstResponseMinutes: null }, open, at(1)),
    ).toEqual({ label: 'No target', tone: 'neutral', ticking: false });
  });

  it('never counts down on a closed ticket', () => {
    const closed = { createdAt: OPENED, status: 'closed' as TicketStatus };
    expect(slaReadout(pending, closed, at(120))).toEqual({
      label: 'Not answered',
      tone: 'neutral',
      ticking: false,
    });
  });
});

describe('ticketControls', () => {
  const ME = 'user-me';
  const OTHER = 'user-other';
  const handler: Capability[] = ['canHandleTickets'];
  const manager: Capability[] = ['canHandleTickets', 'canManageTickets'];

  function controls(
    ticket: Partial<TicketActionInput>,
    capabilities: readonly Capability[] = handler,
  ) {
    return ticketControls(
      { viewer: 'handler', status: 'open', assignee: null, ...ticket },
      { userId: ME, capabilities },
    );
  }

  it('offers a handler the unassigned ticket, then their own assignment', () => {
    const fresh = controls({});
    expect(fresh).toMatchObject({ claim: true, unclaim: false, transfer: false, close: true });
    const mine = controls({ status: 'claimed', assignee: { userId: ME } });
    expect(mine).toMatchObject({
      claim: false,
      unclaim: true,
      transfer: true,
      priority: true,
      waiting: true,
      close: true,
      transcript: false,
    });
  });

  it("BREAK: a plain handler gets nothing that changes someone else's assignment", () => {
    const theirs = controls({ status: 'claimed', assignee: { userId: OTHER } });
    expect(theirs).toMatchObject({
      claim: false,
      unclaim: false,
      transfer: false,
      priority: false,
      waiting: false,
      close: false,
      note: true,
    });
  });

  it('gives managers the full set, transcripts with internal notes and archive', () => {
    const theirs = controls({ status: 'claimed', assignee: { userId: OTHER } }, manager);
    expect(theirs).toMatchObject({
      unclaim: true,
      transfer: true,
      close: true,
      transcript: true,
      transcriptInternal: true,
      archive: false,
    });
    expect(controls({ status: 'closed' }, manager)).toMatchObject({ archive: true, reopen: true });
  });

  it('BREAK: requesters get close, reopen and their own transcript — never staff controls', () => {
    const requester = (status: TicketStatus) =>
      ticketControls(
        { viewer: 'requester', status, assignee: { userId: OTHER } },
        { userId: ME, capabilities: manager },
      );
    expect(requester('waiting')).toEqual({
      claim: false,
      unclaim: false,
      transfer: false,
      priority: false,
      waiting: false,
      resume: false,
      close: true,
      reopen: false,
      archive: false,
      note: false,
      summary: false,
      transcript: true,
      transcriptInternal: false,
    });
    expect(requester('closed')).toMatchObject({ close: false, reopen: true });
  });

  it('archived tickets are read-only', () => {
    const archived = controls({ status: 'archived' }, manager);
    expect(Object.entries(archived).filter(([, allowed]) => allowed)).toEqual([
      ['transcript', true],
      ['transcriptInternal', true],
    ]);
  });
});
