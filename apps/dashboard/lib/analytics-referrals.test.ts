import { describe, expect, it } from 'vitest';
import { retentionHint } from './analytics-kpis';
import {
  coveredDays,
  enumLabel,
  flowPoints,
  formatHours,
  formatMinutes,
  latestValue,
  parseRange,
  seriesTotal,
  signed,
  tierColumns,
} from './analytics-view';
import { campaignDayValue, parseCampaignDay } from './campaign-form';
import {
  anomalyFlagDetail,
  anomalyFlagLabel,
  attachPickerEmptyNote,
  campaignAttachedSummary,
  campaignDeletionNote,
  campaignHref,
  campaignState,
  methodLabel,
  parseReferralTab,
} from './referral-labels';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('analytics view helpers', () => {
  it('accepts only the offered ranges', () => {
    expect(parseRange('7')).toBe(7);
    expect(parseRange('90')).toBe(90);
    expect(parseRange(undefined)).toBe(30);
    expect(parseRange('365')).toBe(30);
    expect(parseRange('7; drop table')).toBe(30);
  });

  it('formats durations, signs and enum labels', () => {
    expect(formatHours(null)).toBe('—');
    expect(formatHours(18.46)).toBe('18.5 h');
    expect(formatHours(55)).toBe('2.3 d');
    expect(formatMinutes(Number.NaN)).toBe('—');
    expect(formatMinutes(42.4)).toBe('42 min');
    expect(formatMinutes(210)).toBe('3.5 h');
    expect(signed(12)).toBe('+12');
    expect(signed(-3)).toBe('−3');
    expect(signed(0)).toBe('0');
    expect(enumLabel('spam_rate')).toBe('Spam rate');
  });

  it('keeps missing days distinct from zero', () => {
    const joins = [
      { day: '2026-09-01', value: 3 },
      { day: '2026-09-02', value: null },
      { day: '2026-09-03', value: 0 },
    ];
    const leaves = [
      { day: '2026-09-01', value: 1 },
      { day: '2026-09-02', value: null },
      { day: '2026-09-03', value: null },
    ];
    expect(flowPoints(joins, leaves)).toEqual([
      { key: '2026-09-01', label: '2026-09-01', value: 3, secondary: 1 },
      { key: '2026-09-02', label: '2026-09-02', value: null, secondary: null },
      { key: '2026-09-03', label: '2026-09-03', value: 0, secondary: 0 },
    ]);
    expect(seriesTotal(joins)).toBe(3);
    expect(seriesTotal([{ day: 'x', value: null }])).toBeNull();
    expect(latestValue(joins)).toBe(0);
    expect(latestValue([])).toBeNull();
    expect(coveredDays(joins)).toBe(2);
  });

  it('describes a retention cohort, and an empty one calmly', () => {
    const window = { start: day('2026-08-01'), end: day('2026-08-28') };
    expect(
      retentionHint({ horizonDays: 30, window, cohort: 1200, retained: 900, rate: 0.75 }),
    ).toBe('900 of 1,200 joins stayed');
    expect(retentionHint({ horizonDays: 30, window, cohort: 0, retained: 0, rate: null })).toBe(
      'No cohort yet',
    );
  });
});

describe('capability heat table', () => {
  const tier = (code: string, count = 0) => ({ code, label: code, count });
  const domain = (key: string, tiers: ReturnType<typeof tier>[]) => ({
    domainKey: key,
    label: key.toUpperCase(),
    tiers,
    verified: 0,
    claimedOnly: 0,
    unknown: 0,
  });
  const catalog = () => [tier('F'), tier('E'), tier('A'), tier('S')];

  it('lists the catalog highest first', () => {
    expect(tierColumns([domain('mind', catalog()), domain('body', catalog())])).toEqual([
      'S',
      'A',
      'E',
      'F',
    ]);
    expect(tierColumns([])).toEqual([]);
  });

  it('BREAK: keeps a verified count on a since-disabled tier in any domain', () => {
    const columns = tierColumns([
      domain('mind', catalog()),
      domain('body', [...catalog(), tier('SS', 2)]),
    ]);
    expect(columns).toEqual(['S', 'A', 'E', 'F', 'SS']);
  });
});

describe('campaign form days', () => {
  it('turns UTC days into window boundaries, the end day inclusive', () => {
    expect(parseCampaignDay('2026-10-01', 'startsAt')).toEqual({
      ok: true,
      value: day('2026-10-01'),
    });
    expect(parseCampaignDay('2026-10-31', 'endsAt')).toEqual({
      ok: true,
      value: day('2026-11-01'),
    });
    expect(parseCampaignDay('  ', 'endsAt')).toEqual({ ok: true, value: null });
  });

  it('BREAK: rejects impossible dates and anything that is not a day', () => {
    for (const raw of ['2026-02-30', '2026-13-01', '26-10-01', '2026-10-01T00:00', 'tomorrow']) {
      expect(parseCampaignDay(raw, 'startsAt')).toEqual({ ok: false });
    }
  });

  it('round-trips what the date inputs show', () => {
    expect(campaignDayValue(day('2026-11-01'), 'endsAt')).toBe('2026-10-31');
    expect(campaignDayValue(day('2026-10-01'), 'startsAt')).toBe('2026-10-01');
    expect(campaignDayValue(new Date('2026-10-05T15:30:00Z'), 'endsAt')).toBe('2026-10-05');
    expect(campaignDayValue(null, 'startsAt')).toBe('');
  });
});

describe('referral labels', () => {
  it('describes why a campaign is or is not crediting joins', () => {
    const now = day('2026-09-26');
    const base = { active: true, acceptingNow: false, startsAt: null };
    expect(campaignState({ ...base, active: false }, now)).toBe('inactive');
    expect(campaignState({ ...base, acceptingNow: true }, now)).toBe('accepting');
    expect(campaignState({ ...base, startsAt: day('2026-10-01') }, now)).toBe('scheduled');
    expect(campaignState({ ...base, startsAt: day('2026-09-01') }, now)).toBe('ended');
  });

  it('labels methods and flags, and survives unknown values', () => {
    expect(methodLabel('vanity')).toBe('Vanity URL');
    expect(methodLabel('carrier_pigeon')).toBe('carrier_pigeon');
    expect(anomalyFlagLabel('join_burst')).toBe('Join burst');
    expect(anomalyFlagDetail('unheard_of')).toBe('Unrecognized signal.');
  });

  it('falls back to the inviters tab for anything unexpected', () => {
    expect(parseReferralTab('review')).toBe('review');
    expect(parseReferralTab('../settings')).toBe('inviters');
    expect(parseReferralTab(undefined)).toBe('inviters');
  });
});

describe('campaign page copy', () => {
  const unused = {
    attachedInvites: 0,
    deletedInvites: 0,
    referralCodes: 0,
    referrals: 0,
    deletable: true,
  };

  it('names what blocks deletion, deleted invites included', () => {
    const active = { active: true };
    const inactive = { active: false };
    expect(campaignDeletionNote(unused, active)).toMatch(/can be removed/);
    expect(campaignDeletionNote({ ...unused, referrals: 3, deletable: false }, active)).toBe(
      'Joins were credited to it. Deactivate it instead: its history stays intact.',
    );
    expect(campaignDeletionNote({ ...unused, referralCodes: 1, deletable: false }, inactive)).toBe(
      'Referral codes were issued for it. It stays inactive, with its history intact.',
    );
    // The reviewer's case: an expired invite is the only thing left, and it can be detached.
    const expired = { ...unused, attachedInvites: 1, deletedInvites: 1, deletable: false };
    expect(campaignDeletionNote(expired, inactive)).toBe(
      'It still has 1 attached invite, deleted on Discord. Detach it to delete the campaign.',
    );
    const mixed = { ...unused, attachedInvites: 3, deletedInvites: 1, deletable: false };
    expect(campaignDeletionNote(mixed, active)).toBe(
      'It still has 3 attached invites, 1 deleted on Discord. Detach them to delete the campaign, or deactivate it instead.',
    );
    const allGone = { ...unused, attachedInvites: 2, deletedInvites: 2, deletable: false };
    expect(campaignDeletionNote(allGone, active)).toMatch(
      /2 attached invites, all deleted on Discord/,
    );
  });

  it('counts live invites apart from the ones Discord deleted', () => {
    expect(campaignAttachedSummary(unused)).toBe('0 live invites attached.');
    expect(campaignAttachedSummary({ ...unused, attachedInvites: 3, deletedInvites: 2 })).toBe(
      '1 live invite attached, 2 deleted on Discord.',
    );
  });

  it('explains an empty attach picker', () => {
    expect(attachPickerEmptyNote({ total: 0, paged: false })).toMatch(/No live invites/);
    expect(attachPickerEmptyNote({ total: 3, paged: false })).toMatch(/Every mirrored invite/);
    expect(attachPickerEmptyNote({ total: 140, paged: true })).toMatch(/on this page/);
  });

  it('keeps the other lists where they were when one pages', () => {
    const id = '0f0e5b1c-8d7e-4a6b-9c1d-2e3f4a5b6c7d';
    expect(campaignHref(id, { offset: 0, attached: 0, picker: 0 })).toBe(
      `/referrals/campaigns/${id}`,
    );
    expect(campaignHref(id, { offset: 25, attached: 0, picker: 100 })).toBe(
      `/referrals/campaigns/${id}?offset=25&picker=100`,
    );
  });
});
