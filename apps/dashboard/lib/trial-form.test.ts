import { describe, expect, it } from 'vitest';
import { ValidationError } from '@jave/core';
import { formFacetKeys, formInteger, formRubric, formScores, formZonedDate } from './trial-form';

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe('trial form parsing', () => {
  it('reads integers, dates in the viewer’s zone, facets and scores', () => {
    const data = form([
      ['teamSize', ' 3 '],
      ['empty', ''],
      ['start', '2026-07-15T18:30'],
      ['facetKeys', 'create.projects'],
      ['facetKeys', 'mind.research'],
      ['score:shipped', '8'],
      ['score:value', ''],
    ]);
    expect(formInteger(data, 'teamSize')).toBe(3);
    expect(formInteger(data, 'empty')).toBeUndefined();
    expect(formZonedDate(data, 'start', 'Europe/Berlin')!.toISOString()).toBe(
      '2026-07-15T16:30:00.000Z',
    );
    expect(formZonedDate(data, 'missing', 'UTC')).toBeNull();
    expect(formFacetKeys(data)).toEqual(['create.projects', 'mind.research']);
    expect(formScores(data, ['shipped', 'value'])).toEqual({ shipped: 8 });
  });

  it('reads the rubric JSON; an emptied weight becomes 0 for the service to refuse', () => {
    const rubric = [
      { key: 'shipped', label: 'Working product', description: '', weight: 3 },
      { key: 'value', label: 'User value', description: 'Real users.', weight: null },
    ];
    expect(formRubric(form([['rubric', JSON.stringify(rubric)]]))).toEqual([
      rubric[0],
      { ...rubric[1], weight: 0 },
    ]);
  });

  it('BREAK: malformed numbers, dates and rubric JSON become field errors', () => {
    const cases: [() => unknown, string][] = [
      [() => formInteger(form([['n', '7.5']]), 'n'), 'n'],
      [() => formInteger(form([['n', '1e3']]), 'n'), 'n'],
      [() => formZonedDate(form([['d', 'tomorrow']]), 'd', 'UTC'), 'd'],
      [() => formRubric(form([['rubric', '{not json']])), 'rubric'],
      [() => formRubric(form([['rubric', '{"key":"x"}']])), 'rubric'],
      [() => formRubric(form([['rubric', JSON.stringify([{ key: 1 }])]])), 'rubric'],
      [() => formRubric(form([['rubric', 'x'.repeat(20_000)]])), 'rubric'],
      [() => formRubric(form([])), 'rubric'],
      [() => formScores(form([['score:shipped', '11.5']]), ['shipped']), 'score:shipped'],
    ];
    for (const [run, field] of cases) {
      try {
        run();
        expect.unreachable(field);
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).issues[0]!.path).toBe(field);
      }
    }
  });
});
