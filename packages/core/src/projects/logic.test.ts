import { describe, expect, it } from 'vitest';
import { InvalidStateError, ValidationError } from '../kernel/errors';
import { assertExactPermutation, nextOrdinal, ORDINAL_CEILING } from './ordering';
import { isValidGithubRepo, normalizeGithubRepo } from './projects.service';
import { hasControlCharacters, httpUrl, isHttpUrl, likePattern } from './schemas';
import { slugify, SLUG_BASE_MAX_LENGTH, SLUG_PATTERN } from './slug';
import {
  assertTransition,
  canTransition,
  isFirstShip,
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  restoredStatus,
} from './status';

describe('project status machine', () => {
  it('walks the happy path IDEA → PLANNING → BUILDING → TESTING → SHIPPED', () => {
    expect(canTransition('idea', 'planning')).toBe(true);
    expect(canTransition('planning', 'building')).toBe(true);
    expect(canTransition('building', 'testing')).toBe(true);
    expect(canTransition('testing', 'shipped')).toBe(true);
  });

  it('allows ARCHIVED from every non-archived state and nothing out of ARCHIVED', () => {
    for (const status of PROJECT_STATUSES) {
      if (status === 'archived') expect(PROJECT_TRANSITIONS.archived).toEqual([]);
      else expect(canTransition(status, 'archived')).toBe(true);
    }
  });

  it('refuses skipping straight from IDEA/PLANNING to SHIPPED', () => {
    expect(canTransition('idea', 'shipped')).toBe(false);
    expect(canTransition('planning', 'shipped')).toBe(false);
    expect(() => assertTransition('idea', 'shipped')).toThrow(InvalidStateError);
  });

  it('refuses no-op and archived transitions with a clear message', () => {
    expect(() => assertTransition('building', 'building')).toThrow(/already BUILDING/);
    expect(() => assertTransition('archived', 'idea')).toThrow(/restored by staff/);
  });

  it('never lists a state as its own successor', () => {
    for (const status of PROJECT_STATUSES) {
      expect(PROJECT_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('counts only the first ship', () => {
    expect(isFirstShip('shipped', null)).toBe(true);
    expect(isFirstShip('shipped', new Date())).toBe(false);
    expect(isFirstShip('testing', null)).toBe(false);
  });

  it('restores the archived-from status, falling back to IDEA', () => {
    expect(restoredStatus('testing')).toBe('testing');
    expect(restoredStatus(null)).toBe('idea');
    expect(restoredStatus('archived')).toBe('idea');
  });
});

describe('slugs', () => {
  it.each([
    ['My Project', 'my-project'],
    ['  Ünïcödé   Rocket!! ', 'unicode-rocket'],
    ['---', 'project'],
    ['<script>alert(1)</script>', 'script-alert-1-script'],
    ['日本語', 'project'],
  ])('slugify(%j) = %j', (title, slug) => {
    expect(slugify(title)).toBe(slug);
    expect(SLUG_PATTERN.test(slugify(title))).toBe(true);
  });

  it('bounds length and never ends with a hyphen', () => {
    const slug = slugify(`${'a'.repeat(SLUG_BASE_MAX_LENGTH - 1)} b`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_BASE_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('GitHub repository names', () => {
  it.each([
    ['Owner/Repo', 'owner/repo', true],
    ['https://github.com/Owner/Repo.git', 'owner/repo', true],
    ['https://www.github.com/a/b/', 'a/b', true],
    ['owner/..', 'owner/..', false],
    ['-owner/repo', '-owner/repo', false],
    ['owner/repo/extra', 'owner/repo/extra', false],
    ['owner', 'owner', false],
    ['own er/repo', 'own er/repo', false],
    [`${'a'.repeat(40)}/repo`, `${'a'.repeat(40)}/repo`, false],
  ])('%j normalizes to %j (valid: %s)', (input, normalized, valid) => {
    expect(normalizeGithubRepo(input)).toBe(normalized);
    expect(isValidGithubRepo(normalizeGithubRepo(input))).toBe(valid);
  });
});

describe('input helpers', () => {
  it.each([
    ['https://example.com/x', true],
    ['http://example.com', true],
    ['javascript:alert(1)', false],
    ['data:text/html,<script>', false],
    ['ftp://example.com', false],
    ['https://user:pass@example.com', false],
    ['//example.com', false],
    ['not a url', false],
  ])('isHttpUrl(%j) = %s', (url, ok) => {
    expect(isHttpUrl(url)).toBe(ok);
  });

  it('normalizes URLs through the WHATWG parser', () => {
    expect(httpUrl.parse(' HTTPS://Example.COM/a b ')).toBe('https://example.com/a%20b');
  });

  it('detects control characters but allows tabs and newlines', () => {
    expect(hasControlCharacters('a\u0000b')).toBe(true);
    expect(hasControlCharacters('bell\u0007')).toBe(true);
    expect(hasControlCharacters('del\u007f')).toBe(true);
    expect(hasControlCharacters('line\nbreak\tand\r\nmore')).toBe(false);
  });

  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });

  it('requires exact permutations for reordering', () => {
    expect(() => assertExactPermutation(['a', 'b'], ['b', 'a'])).not.toThrow();
    expect(() => assertExactPermutation(['a', 'b'], ['a', 'a'])).toThrow(ValidationError);
    expect(() => assertExactPermutation(['a', 'b'], ['a'])).toThrow(ValidationError);
    expect(() => assertExactPermutation(['a', 'b'], ['a', 'c'])).toThrow(ValidationError);
  });

  it('clamps ordinals below the smallint limit', () => {
    expect(nextOrdinal(null)).toBe(0);
    expect(nextOrdinal(4)).toBe(5);
    expect(nextOrdinal(ORDINAL_CEILING)).toBe(ORDINAL_CEILING);
  });
});
