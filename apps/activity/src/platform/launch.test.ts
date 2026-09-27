import { describe, expect, it } from 'vitest';
import { DEFAULT_DEV_INSTANCE, detectLaunch, isSafeApiBase, standaloneDevAllowed } from './launch';

const at = (query: string) => new URL(`https://1234.discordsays.com/${query}`);

describe('launch detection', () => {
  it('inside Discord (frame_id present) calls the API through the URL mapping', () => {
    const launch = detectLaunch(at('?frame_id=abc&instance_id=i-1&platform=desktop'));
    expect(launch).toMatchObject({ mode: 'discord', apiBase: '/.proxy/api' });
  });

  it('standalone is the dev mode, calling the API directly', () => {
    const launch = detectLaunch(new URL('http://localhost:5173/'));
    expect(launch).toMatchObject({
      mode: 'dev',
      apiBase: '/api',
      devInstanceId: DEFAULT_DEV_INSTANCE,
      devPersona: null,
    });
  });

  it('accepts a configured same-origin base path', () => {
    expect(detectLaunch(at('?frame_id=1'), '/api/').apiBase).toBe('/api');
    expect(detectLaunch(new URL('http://localhost/'), '/.proxy/api').apiBase).toBe('/.proxy/api');
  });

  it('BREAK: never sends tokens to another origin through a configured base', () => {
    for (const base of [
      '//evil.example/api',
      'https://evil.example/api',
      'javascript:alert(1)',
      '/../x',
      'api',
    ]) {
      expect(isSafeApiBase(base), base).toBe(false);
      expect(detectLaunch(at('?frame_id=1'), base).apiBase).toBe('/.proxy/api');
    }
  });

  it('reads dev persona and instance from the URL, rejecting odd values', () => {
    const launch = detectLaunch(new URL('http://localhost/?persona=member&instance=table-2'));
    expect(launch).toMatchObject({ devPersona: 'member', devInstanceId: 'dev-table-2' });
    const odd = detectLaunch(new URL('http://localhost/?persona=%3Cscript%3E&instance=a/b'));
    expect(odd).toMatchObject({ devPersona: null, devInstanceId: DEFAULT_DEV_INSTANCE });
    expect(detectLaunch(new URL('http://localhost/?instance=dev-x')).devInstanceId).toBe('dev-x');
  });

  it('BREAK: a production build has no standalone dev mode unless it opts in', () => {
    expect(standaloneDevAllowed({ DEV: true })).toBe(true);
    expect(standaloneDevAllowed({ DEV: false })).toBe(false);
    expect(standaloneDevAllowed({ DEV: false, VITE_JAVE_STANDALONE_DEV: '1' })).toBe(false);
    expect(standaloneDevAllowed({ DEV: false, VITE_JAVE_STANDALONE_DEV: 'true' })).toBe(true);
  });
});
