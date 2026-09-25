import { activeSessionId, attemptNumber, loadSession, saveSession, seenItems } from '../data/storage';
import { planFor } from '../engine/batteries';
import { createSession } from '../engine/session';
import type { Mode, Session } from '../types';
import { detectDevice } from './device';

let current: Session | null = null;
let reportId: string | null = null;

export function startSession(mode: Mode, paradigm?: string): Session {
  const s = createSession({
    mode,
    plan: planFor(mode, paradigm),
    device: detectDevice(),
    now: Date.now(),
    attempt: attemptNumber(mode, paradigm),
    seen: seenItems(),
  });
  saveSession(s);
  current = s;
  return s;
}

/** For the runner: the session, and whether it came back from storage (a reload or a later visit). */
export function sessionForRunner(): { session: Session; fromStorage: boolean } | null {
  if (current && current.status === 'active') return { session: current, fromStorage: false };
  const id = activeSessionId();
  const s = id ? loadSession(id) : null;
  return s ? { session: s, fromStorage: true } : null;
}

/** The session the setup page should offer to resume. */
export function currentSession(): Session | null {
  if (current && current.status === 'active') return current;
  const id = activeSessionId();
  return id ? loadSession(id) : null;
}

export function setCurrent(s: Session) {
  current = s;
}

export function setReportSession(id: string) {
  reportId = id;
  try {
    sessionStorage.setItem('jvln.report', id);
  } catch {
    /* ignore */
  }
}

export function reportSessionId(): string | null {
  if (reportId) return reportId;
  try {
    return sessionStorage.getItem('jvln.report');
  } catch {
    return null;
  }
}
