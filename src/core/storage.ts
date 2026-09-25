import type { StoredResult } from './types';

const KEY = 'jvln.v1';

interface Saved {
  results: Record<string, StoredResult>;
  attempts: Record<string, number>;
}

const empty = (): Saved => ({ results: {}, attempts: {} });

let cache: Saved | null = null;

function load(): Saved {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    cache = empty();
  }
  return cache!;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    // Storage can be unavailable (private mode, blocked site data). Results stay in memory.
  }
}

export const getResults = () => load().results;

export const getResult = (taskId: string): StoredResult | undefined => load().results[taskId];

export const nextAttempt = (taskId: string) => (load().attempts[taskId] ?? 0) + 1;

export function saveResult(result: StoredResult) {
  const data = load();
  data.results[result.taskId] = result;
  data.attempts[result.taskId] = result.attempt;
  persist();
}

export function clearResults() {
  cache = empty();
  persist();
}
