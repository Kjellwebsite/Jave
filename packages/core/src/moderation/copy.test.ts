import { describe, expect, it } from 'vitest';
import type { SecurityEventRecord } from './alerts';
import { buildSecurityAlertCard } from './alerts';
import {
  auditReasonFor,
  caseReference,
  dmTextFor,
  formatDuration,
  formatInstant,
  noticeFor,
  securityReference,
} from './copy';

describe('moderation copy', () => {
  it('formats durations with the two largest units', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(600)).toBe('10m');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(2_419_200)).toBe('28d');
    expect(formatDuration(90_061)).toBe('1d 1h');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('formats instants and references', () => {
    expect(formatInstant(new Date('2026-03-01T13:05:09.123Z'))).toBe('2026-03-01 13:05 UTC');
    expect(caseReference(42)).toBe('CASE-0042');
    expect(securityReference(7)).toBe('SEC-0007');
  });

  it('writes calm, uppercase notices and none for notes', () => {
    const base = { reason: 'Spam.', organizationName: 'Javelin' };
    expect(noticeFor({ ...base, action: 'warn' })).toEqual({
      title: 'WARNING ISSUED',
      body: 'Reason: Spam.',
    });
    expect(
      noticeFor({
        ...base,
        action: 'timeout',
        durationSeconds: 600,
        expiresAt: new Date('2026-03-01T12:10:00Z'),
      }),
    ).toEqual({
      title: 'TIMEOUT — 10M',
      body: 'You can read but not post. Ends 2026-03-01 12:10 UTC. Reason: Spam.',
    });
    expect(noticeFor({ ...base, action: 'ban' })?.title).toBe('BANNED FROM JAVELIN');
    expect(noticeFor({ ...base, action: 'release' })?.body).toBe('Full access restored.');
    expect(noticeFor({ ...base, action: 'note' })).toBeNull();
  });

  it('caps DM and Discord audit-log text', () => {
    const dm = dmTextFor({ title: 'WARNING ISSUED', body: 'x'.repeat(5000) }, 'Javelin');
    expect(dm.length).toBe(2000);
    expect(dm.startsWith('JAVELIN · WARNING ISSUED\n')).toBe(true);
    const reason = auditReasonFor(1, 'y'.repeat(1000));
    expect(reason.length).toBe(512);
    expect(reason.startsWith('JAVE CASE-0001 — ')).toBe(true);
  });
});

describe('security alert card', () => {
  const event = (overrides: Partial<SecurityEventRecord> = {}): SecurityEventRecord => ({
    id: '00000000-0000-4000-8000-000000000001',
    number: 3,
    userId: null,
    riskScore: 40,
    trigger: 'foreign_invite',
    source: 'automod',
    evidence: {
      signals: [{ key: 'foreign_invite', weight: 45, detail: 'discord.gg/x' }],
      messageIds: ['1'],
      excerpt: 'join discord.gg/x',
    },
    actionTaken: 'timeout',
    status: 'open',
    channelId: null,
    reportedByUserId: null,
    dedupeKey: null,
    alertChannelId: null,
    alertMessageId: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date('2026-03-01T12:00:00Z'),
    updatedAt: new Date('2026-03-01T12:00:00Z'),
    ...overrides,
  });
  const card = (overrides: Partial<SecurityEventRecord> = {}) =>
    buildSecurityAlertCard({
      event: event(overrides),
      subject: { discordId: '123', name: 'spammer' },
      moderator: null,
      quarantineRiskScore: 85,
      timeoutSeconds: 600,
    });
  const field = (c: ReturnType<typeof card>, label: string) =>
    c.fields.find((f) => f.label === label)?.value;

  it('grades severity against the quarantine threshold', () => {
    expect(card({ riskScore: 40 }).severity).toBe('low');
    expect(card({ riskScore: 50 }).severity).toBe('elevated');
    expect(card({ riskScore: 85 }).severity).toBe('critical');
  });

  it('renders every field and hides buttons once reviewed', () => {
    const open = card();
    expect(open.title).toBe('SECURITY EVENT SEC-0003 — FOREIGN INVITE');
    expect(field(open, 'USER')).toBe('spammer (123)');
    expect(field(open, 'ACTION')).toBe('TIMEOUT 10m · OPEN');
    expect(field(open, 'MODERATOR')).toBe('AUTOMOD');
    expect(field(open, 'EVIDENCE')).toBe(
      'foreign_invite (45) — discord.gg/x\n1 message(s)\n“join discord.gg/x”',
    );
    expect(open.actionable).toBe(true);
    expect(card({ status: 'dismissed' }).actionable).toBe(false);
    expect(card({ status: 'acknowledged' }).actionable).toBe(true);
  });
});
