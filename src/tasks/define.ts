import type { z } from 'zod';
import type { ParadigmInfo, ProcedureContext, ProcedureParadigm } from '../items/paradigm';
import type { ProcedureScore } from '../types';
import type { Rng } from '../utils/rng';

/** Define a procedure paradigm whose results are validated with a Zod schema. */
export function defineProcedure<Config, Schema extends z.ZodType>(
  def: ParadigmInfo & {
    result: Schema;
    build(rng: Rng, ctx: ProcedureContext): Config;
    score(config: Config, result: z.infer<Schema>, rng: Rng): ProcedureScore;
  },
): ProcedureParadigm<Config, z.infer<Schema>> {
  const { result, ...rest } = def;
  return {
    ...rest,
    kind: 'procedure',
    validate: (r: unknown): r is z.infer<Schema> => result.safeParse(r).success,
  };
}
