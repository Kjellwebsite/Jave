import { z } from 'zod';
import { type JobHandlerMap, PermanentJobError } from '../jobs/worker';
import { RESEARCH_ENRICH_JOB, RESEARCH_SYNC_SIDUS_JOB } from './constants';
import { enrichResearchItem } from './enrichment';
import { ArxivResolver } from './metadata/arxiv';
import { CrossrefResolver } from './metadata/crossref';
import type { MetadataResolver } from './metadata/types';
import { NotConfiguredSidusClient, type SidusClient } from './sidus';
import { syncResearchItemToSidus } from './sync';

export interface ResearchJobDeps {
  resolvers: readonly MetadataResolver[];
  sidus: SidusClient;
}

/**
 * Defaults used by the static registry: public Crossref/arXiv resolvers and
 * the not-configured Sidus client (sync is recorded as not_synced, never
 * faked). Deployments with Sidus credentials compose
 * `createJobHandlers({ ...defaultResearchJobDeps(), sidus: createSidusClient(env) })`.
 */
export function defaultResearchJobDeps(): ResearchJobDeps {
  return {
    resolvers: [new CrossrefResolver(), new ArxivResolver()],
    sidus: new NotConfiguredSidusClient(),
  };
}

const itemPayloadSchema = z.object({ itemId: z.uuid() });

function itemIdFrom(payload: Record<string, unknown>): string {
  const parsed = itemPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError('invalid research job payload');
  return parsed.data.itemId;
}

export function createJobHandlers(deps: ResearchJobDeps): JobHandlerMap {
  return {
    [RESEARCH_ENRICH_JOB]: (ctx, payload, job) =>
      enrichResearchItem(ctx, deps.resolvers, itemIdFrom(payload), {
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      }),
    [RESEARCH_SYNC_SIDUS_JOB]: (ctx, payload, job) =>
      syncResearchItemToSidus(ctx, deps.sidus, itemIdFrom(payload), {
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
      }),
  };
}
