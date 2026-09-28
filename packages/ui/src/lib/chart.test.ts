import { describe, expect, it } from 'vitest';
import {
  areaPaths,
  divergingLayout,
  formatRate,
  gapBand,
  heatIntensity,
  linePaths,
  MIN_HEAT,
  niceScale,
  niceStep,
  percentOf,
  pointIndex,
  pointX,
  slotIndex,
} from './chart';

describe('niceScale', () => {
  it('covers the maximum with round integer ticks from zero', () => {
    expect(niceScale(7)).toEqual({ max: 10, ticks: [0, 5, 10] });
    expect(niceScale(100)).toEqual({ max: 100, ticks: [0, 50, 100] });
    expect(niceScale(1)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(2481).max).toBeGreaterThanOrEqual(2481);
  });

  it('never produces fractional steps for counts', () => {
    for (const max of [0.2, 1, 2, 3, 5, 9, 11, 26, 333, 1001]) {
      const { ticks } = niceScale(max);
      expect(ticks.every(Number.isInteger), String(max)).toBe(true);
      expect(ticks[0]).toBe(0);
    }
    expect(niceStep(0.02)).toBe(1);
  });

  it('BREAK: empty, negative and non-finite maxima still give a drawable axis', () => {
    for (const max of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(niceScale(max)).toEqual({ max: 1, ticks: [0, 1] });
    }
  });
});

describe('positions', () => {
  it('clamps percentages and treats a zero scale as empty', () => {
    expect(percentOf(5, 10)).toBe(50);
    expect(percentOf(15, 10)).toBe(100);
    expect(percentOf(-1, 10)).toBe(0);
    expect(percentOf(3, 0)).toBe(0);
  });

  it('maps pointer offsets to slots and points', () => {
    expect(slotIndex(0, 300, 30)).toBe(0);
    expect(slotIndex(299, 300, 30)).toBe(29);
    expect(slotIndex(-20, 300, 30)).toBe(0);
    expect(slotIndex(900, 300, 30)).toBe(29);
    expect(slotIndex(10, 300, 0)).toBeNull();
    expect(pointIndex(150, 300, 3)).toBe(1);
    expect(pointIndex(10, 300, 1)).toBe(0);
    expect(pointX(0, 5)).toBe(0);
    expect(pointX(4, 5)).toBe(100);
    expect(pointX(0, 1)).toBe(50);
  });
});

describe('line geometry', () => {
  it('breaks lines at gaps and closes areas to the baseline', () => {
    const values = [1, 2, null, 4, null, 3, 3];
    expect(linePaths(values, 4)).toEqual(['M0 75 L1 50', 'M5 25 L6 25']);
    expect(areaPaths(values, 4)).toEqual([
      'M0 100 L0 75 L1 50 L1 100 Z',
      'M5 100 L5 25 L6 25 L6 100 Z',
    ]);
  });
});

describe('gapBand', () => {
  it('shades half a step either side of a missing point, clipped to the plot', () => {
    // 5 points: 25% apart.
    expect(gapBand(2, 5)).toEqual({ left: 37.5, width: 25 });
    expect(gapBand(0, 5)).toEqual({ left: 0, width: 12.5 });
    expect(gapBand(4, 5)).toEqual({ left: 87.5, width: 12.5 });
  });

  it('lets a run of missing points read as one band', () => {
    const first = gapBand(1, 5);
    const second = gapBand(2, 5);
    expect(first.left + first.width).toBe(second.left);
  });

  it('BREAK: a single point covers the whole plot', () => {
    expect(gapBand(0, 1)).toEqual({ left: 0, width: 100 });
  });
});

describe('divergingLayout', () => {
  it('puts both sides on one scale so equal counts draw equal lengths', () => {
    const layout = divergingLayout([4, 8], [2, 3]);
    expect(layout.upMax).toBe(10);
    expect(layout.downMax).toBe(3);
    // 3 below spans the lower area exactly as 3 above spans 3/10 of the upper one.
    expect(layout.baseline).toBeCloseTo(10 / 13);
    expect(1 - layout.baseline).toBeCloseTo((3 / layout.upMax) * layout.baseline);
  });

  it('centres the baseline when there is no data', () => {
    expect(divergingLayout([null, 0], [0])).toEqual({ upMax: 1, downMax: 1, baseline: 0.5 });
  });
});

describe('formatting', () => {
  it('formats rates as whole percentages and unknown as a dash', () => {
    expect(formatRate(0.4167)).toBe('42%');
    expect(formatRate(0)).toBe('0%');
    expect(formatRate(null)).toBe('—');
    expect(formatRate(Number.NaN)).toBe('—');
  });

  it('never renders a non-zero heat cell invisible', () => {
    expect(heatIntensity(0, 10)).toBe(0);
    expect(heatIntensity(1, 1000)).toBeGreaterThanOrEqual(MIN_HEAT);
    expect(heatIntensity(10, 10)).toBe(1);
  });
});
