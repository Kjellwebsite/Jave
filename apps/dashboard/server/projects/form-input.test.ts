import { describe, expect, it } from 'vitest';
import { ValidationError } from '@jave/core';
import { dateField, handleField, nullableText, uuidField } from './form-input';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const ID = '0b6f4c1e-5d3a-4f8e-9a2b-7c1d2e3f4a5b';

describe('uuidField', () => {
  it('accepts a uuid and refuses anything else as an unknown record', () => {
    expect(uuidField(form({ projectId: ID }), 'projectId', 'project')).toBe(ID);
    for (const forged of ['', 'rocket-engine', `${ID}' or 1=1`, '../admin']) {
      expect(() => uuidField(form({ projectId: forged }), 'projectId', 'project')).toThrow(
        'Unknown project.',
      );
    }
  });
});

describe('nullableText', () => {
  it('blank clears, anything else passes through for core to validate', () => {
    expect(nullableText(form({ summary: '   ' }), 'summary')).toBeNull();
    expect(nullableText(form({}), 'summary')).toBeNull();
    expect(nullableText(form({ summary: ' Fast. ' }), 'summary')).toBe('Fast.');
  });
});

describe('dateField', () => {
  it('reads a calendar date as UTC midnight', () => {
    expect(dateField(form({ dueAt: '2026-10-01' }), 'dueAt')?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(dateField(form({ dueAt: '' }), 'dueAt')).toBeUndefined();
  });

  it('BREAK: impossible or malformed dates are validation errors on the field', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '01/10/2026', '2026-10-01T00:00']) {
      const run = () => dateField(form({ dueAt: bad }), 'dueAt');
      expect(run).toThrow(ValidationError);
      try {
        run();
      } catch (error) {
        expect((error as ValidationError).issues[0]?.path).toBe('dueAt');
      }
    }
  });
});

describe('handleField', () => {
  it('strips a leading @ and lowercases', () => {
    expect(handleField(form({ handle: '@Mara' }), 'handle')).toBe('mara');
    expect(handleField(form({ handle: 'jun' }), 'handle')).toBe('jun');
  });

  it('BREAK: empty or oversized handles are refused', () => {
    expect(() => handleField(form({ handle: '@' }), 'handle')).toThrow(ValidationError);
    expect(() => handleField(form({ handle: 'x'.repeat(65) }), 'handle')).toThrow(ValidationError);
  });
});
