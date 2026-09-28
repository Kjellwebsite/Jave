import { describe, expect, it } from 'vitest';
import {
  clock,
  HYPNOGRAM,
  NIGHT,
  plasmaLevel,
  plasmaPeak,
  released,
  STAGE_RANGES,
  stageAt,
  stageMinutes,
  stageShares,
} from './sleep';

describe('schematic night', () => {
  it('covers the whole night without gaps', () => {
    expect(HYPNOGRAM[0]?.start).toBe(0);
    expect(HYPNOGRAM[HYPNOGRAM.length - 1]?.end).toBe(NIGHT.minutes);
    HYPNOGRAM.slice(1).forEach((segment, i) => expect(segment.start).toBe(HYPNOGRAM[i]!.end));
  });

  it('keeps every sleep stage inside the textbook range', () => {
    const shares = stageShares();
    for (const [stage, [low, high]] of Object.entries(STAGE_RANGES)) {
      const share = shares[stage as keyof typeof shares];
      expect(share).toBeGreaterThanOrEqual(low);
      expect(share).toBeLessThanOrEqual(high);
    }
  });

  it('puts deep sleep in the first half and lengthens REM towards the morning', () => {
    const deepEarly = HYPNOGRAM.filter((s) => s.stage === 'N3' && s.end <= NIGHT.minutes / 2)
      .map((s) => s.end - s.start)
      .reduce((a, b) => a + b, 0);
    expect(deepEarly / stageMinutes().N3).toBeGreaterThan(0.8);
    const rem = HYPNOGRAM.filter((s) => s.stage === 'R').map((s) => s.end - s.start);
    expect(rem).toEqual([...rem].sort((a, b) => a - b));
  });

  it('reads stages and clock times', () => {
    expect(stageAt(0)).toBe('W');
    expect(stageAt(40)).toBe('N3');
    expect(stageAt(NIGHT.minutes)).toBe('W');
    expect(clock(0)).toBe('22:30');
    expect(clock(90)).toBe('00:00');
    expect(clock(NIGHT.minutes)).toBe('06:30');
  });
});

describe('release profile', () => {
  const top = { start: 0, end: 0.5 };
  const core = { start: 0.5, end: 6 };

  it('dissolves the top layer within minutes', () => {
    expect(released(top, 0)).toBe(0);
    expect(released(top, 0.5)).toBeCloseTo(0.95, 2);
    expect(released(top, 1)).toBeGreaterThan(0.99);
  });

  it('releases the core over hours and finishes at the end of its window', () => {
    expect(released(core, 0.5)).toBe(0);
    expect(released(core, 3.25)).toBeCloseTo(0.5, 5);
    expect(released(core, 6)).toBe(1);
    const steps = Array.from({ length: 49 }, (_, i) => released(core, i / 6));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });
});

describe('melatonin model', () => {
  it('peaks after about 50 minutes', () => {
    expect(plasmaPeak(45) * 60).toBeGreaterThan(40);
    expect(plasmaPeak(45) * 60).toBeLessThan(60);
    expect(plasmaLevel(plasmaPeak(45), 45)).toBeCloseTo(1, 6);
  });

  it('is practically gone by the morning', () => {
    expect(plasmaLevel(0, 45)).toBe(0);
    expect(plasmaLevel(8, 45)).toBeLessThan(0.005);
  });
});
