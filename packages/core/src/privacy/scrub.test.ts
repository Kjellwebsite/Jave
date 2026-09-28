import { describe, expect, it } from 'vitest';
import { likePatterns, scrubJson, scrubTerms, scrubText } from './scrub';

const R = 'Erased member';

describe('privacy: scrub', () => {
  it('collects distinct terms, longest first', () => {
    expect(
      scrubTerms({
        username: 'nova',
        userDisplayName: 'Nova Quill',
        memberDisplayName: 'nova quill',
        handle: 'nova',
        otherNames: ['nq-builds', ' '],
      }),
    ).toEqual(['Nova Quill', 'nq-builds', 'nova']);
  });

  it('replaces whole words only, in any case', () => {
    const terms = ['Nova Quill', 'nova'];
    expect(scrubText('Welcome, NOVA QUILL. Nova shipped.', terms, R)).toBe(
      `Welcome, ${R}. ${R} shipped.`,
    );
    expect(scrubText('supernova and novation stay', terms, R)).toBe('supernova and novation stay');
    expect(scrubText('@nova_x stays; nova-x is a handle', ['nova'], R)).toBe(
      `@nova_x stays; ${R}-x is a handle`,
    );
  });

  it('only replaces short names when they are the whole value', () => {
    expect(scrubText('Al is here. Also fine.', ['Al'], R)).toBe('Al is here. Also fine.');
    expect(scrubText(' al ', ['Al'], R)).toBe(R);
  });

  it('treats regex characters in names literally', () => {
    expect(scrubText('Thanks, a.b*c (x)', ['a.b*c (x)'], R)).toBe(`Thanks, ${R}`);
    expect(scrubText('Thanks, axb', ['a.b'], R)).toBe('Thanks, axb');
  });

  it('scrubs string values in JSON and never keys', () => {
    expect(
      scrubJson(
        { nova: 'nova', list: ['Nova Quill', 3, null], nested: { by: 'nova' } },
        ['Nova Quill', 'nova'],
        R,
      ),
    ).toEqual({ nova: R, list: [R, 3, null], nested: { by: R } });
  });

  it('builds LIKE patterns for plain and JSON-escaped text', () => {
    expect(likePatterns('50%_off')).toEqual(['%50\\%\\_off%']);
    expect(likePatterns('a"b')).toEqual(['%a"b%', '%a\\\\"b%']);
  });
});
