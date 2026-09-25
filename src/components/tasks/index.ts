import { type ComponentType, lazy } from 'react';
import type { ItemRendererProps, ProcedureRendererProps } from '../runner/types';
import './tasks.css';

type ItemComp = ComponentType<ItemRendererProps<any>>;
type ProcComp = ComponentType<ProcedureRendererProps<any>>;

const TextChoice = lazy(() => import('./TextChoiceItem'));

const ITEM: Record<string, ItemComp> = {
  matrix: lazy(() => import('./MatrixItem')),
  series: lazy(() => import('./SeriesItem')),
  deduction: lazy(() => import('./DeductionItem')),
  analogy: lazy(() => import('./AnalogyItem')),
  balance: lazy(() => import('./BalanceItem')),
  probability: TextChoice,
  spatialSpan: lazy(() => import('./SpatialSpanItem')),
  verbalSpan: lazy(() => import('./VerbalSpanItem')),
  tower: lazy(() => import('./TowerItem')),
  games: lazy(() => import('./GamesItem')),
  beliefs: lazy(() => import('./BeliefsItem')),
  language: lazy(() => import('./LanguageItem')),
  orientation: lazy(() => import('./OrientationItem')),
  specimens: lazy(() => import('./SpecimensItem')),
  layout: lazy(() => import('./LayoutItem')),
  rat: lazy(() => import('./RatItem')),
  social: TextChoice,
  strategic: TextChoice,
  semantic: TextChoice,
  reading: TextChoice,
  prompting: TextChoice,
};

const PROC: Record<string, ProcComp> = {
  reaction: lazy(() => import('./ReactionTask')),
  search: lazy(() => import('./SearchTask')),
  sart: lazy(() => import('./SartTask')),
  flanker: lazy(() => import('./FlankerTask')),
  switching: lazy(() => import('./SwitchingTask')),
  rules: lazy(() => import('./RulesTask')),
  category: lazy(() => import('./CategoryTask')),
  categoryRetain: lazy(() => import('./CategoryRetainTask')),
  reversal: lazy(() => import('./ReversalTask')),
  nback: lazy(() => import('./NBackTask')),
  pairsEncode: lazy(() => import('./PairsTasks').then((m) => ({ default: m.PairsEncodeTask }))),
  pairsRecall: lazy(() => import('./PairsTasks').then((m) => ({ default: m.PairsRecallTask }))),
  dualTask: lazy(() => import('./DualTask')),
  typing: lazy(() => import('./TypingTask')),
  uses: lazy(() => import('./CreativeTasks').then((m) => ({ default: m.UsesTask }))),
  constrained: lazy(() => import('./CreativeTasks').then((m) => ({ default: m.ConstrainedTask }))),
};

export function itemRenderer(paradigm: string): ItemComp {
  const r = ITEM[paradigm];
  if (!r) throw new Error(`No renderer for ${paradigm}`);
  return r;
}

export function procedureRenderer(paradigm: string): ProcComp {
  const r = PROC[paradigm];
  if (!r) throw new Error(`No renderer for ${paradigm}`);
  return r;
}

export const hasRenderer = (paradigm: string) => paradigm in ITEM || paradigm in PROC;
