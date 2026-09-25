import type { z } from 'zod';
import type { ServiceContext } from '../../kernel/context';
import { parseInput } from '../../kernel/validation';
import type { Capability } from '../../permissions/capabilities';

export interface ActionMeta {
  proposalId: string;
  requestedByUserId: string;
}

/** What EXECUTE produced. `queued` means a side effect (e.g. a Discord post) is pending. */
export interface ActionOutcome {
  status: 'executed' | 'queued';
  /** One calm line for the REPORT, e.g. "MISSION DRAFTED — #0042 Build a CLI. Status: DRAFT." */
  summary: string;
  data: Record<string, unknown>;
}

/**
 * An action the AI may propose. Nothing executes until a human holding
 * `capabilityToConfirm` confirms the stored, previewed payload.
 */
export interface ActionKindDefinition<S extends z.ZodType<Record<string, unknown>>> {
  kind: string;
  description: string;
  /** Who may create a proposal of this kind (limits who can queue work for others). */
  capabilityToPropose: Capability;
  capabilityToConfirm: Capability;
  /**
   * 'requester': only the member who asked may confirm (their own content).
   * 'capability': any holder of `capabilityToConfirm`; confirming someone
   * else's proposal additionally requires `canConfirmAIActions`.
   */
  confirmableBy: 'requester' | 'capability';
  payloadSchema: S;
  preview(payload: z.output<S>): string;
  /**
   * Domain permission checks for the confirming human, run BEFORE the
   * confirmation transaction opens. Denials are audited durably (outside any
   * transaction), so they must not happen inside `execute`.
   */
  authorizeExecution?(ctx: ServiceContext, payload: z.output<S>): Promise<void>;
  /** Runs inside the confirmation transaction; its writes commit with the audit and event. */
  execute(ctx: ServiceContext, payload: z.output<S>, meta: ActionMeta): Promise<ActionOutcome>;
}

/** Type-erased kind: every entry point re-validates the payload with the kind's schema. */
export interface RegisteredActionKind {
  kind: string;
  description: string;
  capabilityToPropose: Capability;
  capabilityToConfirm: Capability;
  confirmableBy: 'requester' | 'capability';
  parse(payload: unknown): Record<string, unknown>;
  preview(payload: unknown): string;
  authorizeExecution(ctx: ServiceContext, payload: unknown): Promise<void>;
  execute(ctx: ServiceContext, payload: unknown, meta: ActionMeta): Promise<ActionOutcome>;
}

export function defineActionKind<S extends z.ZodType<Record<string, unknown>>>(
  definition: ActionKindDefinition<S>,
): RegisteredActionKind {
  const parse = (payload: unknown) => parseInput(definition.payloadSchema, payload);
  return {
    kind: definition.kind,
    description: definition.description,
    capabilityToPropose: definition.capabilityToPropose,
    capabilityToConfirm: definition.capabilityToConfirm,
    confirmableBy: definition.confirmableBy,
    parse,
    preview: (payload) => definition.preview(parse(payload)),
    authorizeExecution: async (ctx, payload) => {
      await definition.authorizeExecution?.(ctx, parse(payload));
    },
    execute: (ctx, payload, meta) => definition.execute(ctx, parse(payload), meta),
  };
}
