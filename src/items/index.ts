import { registerParadigms } from '../engine/registry';
import { category, categoryRetain } from '../tasks/category';
import { constrained, uses } from '../tasks/creative';
import { dualTask } from '../tasks/dual';
import { flanker } from '../tasks/flanker';
import { nback } from '../tasks/nback';
import { pairsEncode, pairsRecall } from '../tasks/pairs';
import { reaction } from '../tasks/reaction';
import { reversal } from '../tasks/reversal';
import { rules } from '../tasks/rules';
import { sart } from '../tasks/sart';
import { search } from '../tasks/search';
import { switching } from '../tasks/switching';
import { typing } from '../tasks/typing';
import { prompting } from './banks/prompting';
import { reading } from './banks/reading';
import { semantic } from './banks/semantic';
import { social } from './banks/social';
import { strategic } from './banks/strategic';
import { analogy } from './generators/analogy';
import { balance } from './generators/balance';
import { beliefs } from './generators/beliefs';
import { deduction } from './generators/deduction';
import { games } from './generators/games';
import { language } from './generators/language';
import { layout } from './generators/layout';
import { matrix } from './generators/matrix';
import { orientation } from './generators/orientation';
import { probability } from './generators/probability';
import { rat } from './generators/rat';
import { series } from './generators/series';
import { spatialSpan, verbalSpan } from './generators/span';
import { specimens } from './generators/specimens';
import { tower } from './generators/tower';
import type { Paradigm } from './paradigm';

export const PARADIGMS: Paradigm[] = [
  matrix,
  series,
  deduction,
  analogy,
  balance,
  probability,
  spatialSpan,
  verbalSpan,
  nback,
  pairsEncode,
  pairsRecall,
  reaction,
  search,
  sart,
  tower,
  switching,
  flanker,
  rules,
  category,
  categoryRetain,
  reversal,
  games,
  strategic,
  beliefs,
  social,
  language,
  semantic,
  reading,
  orientation,
  specimens,
  dualTask,
  typing,
  rat,
  uses,
  constrained,
  prompting,
  layout,
] as Paradigm[];

let done = false;

export function registerAll() {
  if (done) return;
  registerParadigms(PARADIGMS);
  done = true;
}
