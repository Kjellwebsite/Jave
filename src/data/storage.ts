/**
 * Local persistence. Sessions stay on the device; nothing is sent anywhere.
 * Every read is validated so corrupted or foreign data cannot crash the app.
 */
import { z } from 'zod';
import type { Session } from '../types';

const PREFIX = 'jvln.v1.';
const ACTIVE = `${PREFIX}active`;
const INDEX = `${PREFIX}sessions`;
const SEEN = `${PREFIX}seen`;

const sessionShape = z
  .object({
    schema: z.literal(1),
    id: z.string(),
    seed: z.number(),
    mode: z.enum(['quick', 'core', 'full', 'single']),
    status: z.enum(['active', 'complete']),
    plan: z.array(z.object({ id: z.string(), paradigm: z.string() }).passthrough()),
    sections: z.array(z.object({ id: z.string(), paradigm: z.string(), responses: z.array(z.unknown()) }).passthrough()),
    cursor: z.number().int().min(0),
    events: z.array(z.unknown()),
  })
  .passthrough();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

export interface SessionSummary {
  id: string;
  mode: Session['mode'];
  status: Session['status'];
  createdAt: number;
  updatedAt: number;
  paradigm?: string;
}

export function listSessions(): SessionSummary[] {
  try {
    const parsed = JSON.parse(read(INDEX) ?? '[]');
    return Array.isArray(parsed) ? (parsed as SessionSummary[]).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function loadSession(id: string): Session | null {
  const raw = read(PREFIX + id);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return sessionShape.safeParse(data).success ? (data as Session) : null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused to store (private mode, quota). */
export function saveSession(s: Session): boolean {
  const ok = write(PREFIX + s.id, JSON.stringify(s));
  const index = listSessions().filter((x) => x.id !== s.id);
  index.push({ id: s.id, mode: s.mode, status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt, paradigm: s.mode === 'single' ? s.plan[0]?.paradigm : undefined });
  write(INDEX, JSON.stringify(index.slice(-30)));
  if (s.status === 'active') write(ACTIVE, s.id);
  else if (read(ACTIVE) === s.id) remove(ACTIVE);
  if (s.status === 'complete') recordSeen(s);
  return ok;
}

export function activeSessionId(): string | null {
  return read(ACTIVE);
}

export function clearActive() {
  remove(ACTIVE);
}

export function deleteSession(id: string) {
  remove(PREFIX + id);
  write(INDEX, JSON.stringify(listSessions().filter((x) => x.id !== id)));
  if (read(ACTIVE) === id) remove(ACTIVE);
}

export function deleteAll() {
  for (const s of listSessions()) remove(PREFIX + s.id);
  remove(INDEX);
  remove(ACTIVE);
  remove(SEEN);
}

export function seenItems(): string[] {
  try {
    const parsed = JSON.parse(read(SEEN) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function recordSeen(s: Session) {
  const ids = s.sections.flatMap((x) => x.responses.map((r) => r.itemId)).filter((id) => !/:v\d+:L/.test(id));
  write(SEEN, JSON.stringify([...new Set([...seenItems(), ...ids])].slice(-2000)));
}

/** Count previous completed attempts of the same mode (for practice-effect flags). */
export function attemptNumber(mode: Session['mode'], paradigm?: string): number {
  return listSessions().filter((s) => s.mode === mode && s.status === 'complete' && (mode !== 'single' || s.paradigm === paradigm)).length + 1;
}
