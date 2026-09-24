import type { DomainSummary } from '@jave/core';
import { Mono, RankBadge } from '@jave/ui';
import type { FormAction } from '../forms/action-form';
import { EvaluatorControls, type EvidenceOption } from './evaluator-controls';

export interface EvaluatorContext {
  memberId: string;
  memberName: string;
  tiers: readonly string[];
  notes: Readonly<Record<string, string | null>>;
  evidence: readonly EvidenceOption[];
  setRankAction: FormAction;
  notesAction: FormAction;
}

export interface CapabilityMatrixProps {
  domains: readonly DomainSummary[];
  facetDescriptions: Readonly<Record<string, string>>;
  domainDescriptions: Readonly<Record<string, string>>;
  claimsVisible: boolean;
  /** Present only for actors who may evaluate this member. */
  evaluator: EvaluatorContext | null;
}

/**
 * Domain × facet capability. Each facet shows one status plate — VERIFIED
 * (solid chrome), CLAIMED (dashed, labelled) or UNKNOWN (dash). A domain's
 * rank is its peak facet; there is no total.
 */
export function CapabilityMatrix({
  domains,
  facetDescriptions,
  domainDescriptions,
  claimsVisible,
  evaluator,
}: CapabilityMatrixProps) {
  return (
    <div className="space-y-4">
      {!claimsVisible ? (
        <p className="text-small text-fg-subtle">This member keeps their CLAIMED ranks private.</p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {domains.map((domain) => (
          <section
            key={domain.key}
            aria-labelledby={`domain-${domain.key}`}
            className="machined relative rounded-lg border border-line bg-surface"
          >
            <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
              <div className="min-w-0">
                <h3 id={`domain-${domain.key}`} className="type-eyebrow text-fg">
                  {domain.label}
                </h3>
                <p className="mt-1 text-small text-fg-subtle">{domainDescriptions[domain.key]}</p>
              </div>
              <RankBadge
                verifiedRank={domain.verifiedRank}
                claimedRank={domain.claimedRank}
                size="md"
              />
            </header>
            <ul className="divide-y divide-line-subtle">
              {domain.facets.map((facet) => {
                const note = evaluator?.notes[facet.facetKey] ?? null;
                return (
                  <li
                    key={facet.facetKey}
                    data-facet={facet.facetKey}
                    className="flex items-start gap-4 px-5 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-body text-fg">{facet.label}</p>
                      <p className="mt-0.5 text-small text-fg-subtle">
                        {facetDescriptions[facet.facetKey]}
                      </p>
                      {note ? (
                        <p className="mt-1.5 line-clamp-2 text-small text-fg-muted">
                          <span className="type-eyebrow mr-2 text-[10px] text-fg-subtle">NOTE</span>
                          {note}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                      <RankBadge
                        verifiedRank={facet.verifiedRank}
                        claimedRank={facet.claimedRank}
                        size="sm"
                      />
                      {facet.verifiedRank &&
                      facet.claimedRank &&
                      facet.claimedRank !== facet.verifiedRank ? (
                        <Mono dim className="text-[11px]">
                          claimed {facet.claimedRank}
                        </Mono>
                      ) : null}
                    </div>
                    {evaluator ? (
                      <EvaluatorControls
                        memberId={evaluator.memberId}
                        memberName={evaluator.memberName}
                        facetKey={facet.facetKey}
                        facetLabel={facet.label}
                        verifiedRank={facet.verifiedRank}
                        claimedRank={facet.claimedRank}
                        notes={note}
                        tiers={evaluator.tiers}
                        evidence={evaluator.evidence}
                        setRankAction={evaluator.setRankAction}
                        notesAction={evaluator.notesAction}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
