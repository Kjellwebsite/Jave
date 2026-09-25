import type { ItemParadigm, Paradigm, ProcedureParadigm } from '../items/paradigm';

const registry = new Map<string, Paradigm>();

export function registerParadigms(list: Paradigm[]) {
  for (const p of list) {
    if (registry.has(p.id) && registry.get(p.id) !== p) throw new Error(`Duplicate paradigm id ${p.id}`);
    registry.set(p.id, p);
  }
}

export function getParadigm(id: string): Paradigm {
  const p = registry.get(id);
  if (!p) throw new Error(`Unknown paradigm ${id}`);
  return p;
}

export const hasParadigm = (id: string) => registry.has(id);

export const allParadigms = () => [...registry.values()];

export const isItemParadigm = (p: Paradigm): p is ItemParadigm => p.kind === 'items';
export const isProcedureParadigm = (p: Paradigm): p is ProcedureParadigm => p.kind === 'procedure';
