import { Callout, formatCount, Mono, Panel, StatusBadge } from '@jave/ui';
import { type Fact, FactList } from '@/components/fact-list';
import { PROVIDER_STATE_LABELS, PROVIDER_STATE_TONE } from '@/lib/ai-labels';

export interface ProviderPanelProps {
  state: keyof typeof PROVIDER_STATE_LABELS;
  provider: string;
  model: string;
  /** Operator detail (health text, check time) — only for canViewSystemStatus. */
  diagnostics: { detail: string; checkedAt: string; configurationError: string | null } | null;
  isMock: boolean;
}

/** Which provider answers and whether it is reachable. */
export function ProviderPanel({ state, provider, model, diagnostics, isMock }: ProviderPanelProps) {
  const facts: Fact[] = [
    {
      label: 'STATUS',
      value: (
        <StatusBadge
          tone={PROVIDER_STATE_TONE[state]}
          quiet={state === 'ok'}
          label={PROVIDER_STATE_LABELS[state].toUpperCase()}
        />
      ),
    },
    { label: 'PROVIDER', value: <Mono>{provider}</Mono> },
    { label: 'MODEL', value: <Mono>{model}</Mono> },
  ];
  if (diagnostics) {
    facts.push(
      { label: 'LAST CHECK', value: <Mono dim>{diagnostics.checkedAt}</Mono> },
      { label: 'DETAIL', value: diagnostics.detail },
    );
  }
  return (
    <Panel
      title="Provider"
      description="Answers come from this model. JAVE never stores prompts or answers."
    >
      <div className="space-y-4">
        {isMock ? (
          <Callout tone="warning" title="MOCK / DEVELOPMENT ONLY">
            Deterministic offline provider. Answers are placeholders, not model output.
          </Callout>
        ) : null}
        {diagnostics?.configurationError ? (
          <Callout tone="danger" title="CONFIGURATION ERROR">
            {diagnostics.configurationError}. AI stays disabled until the environment is fixed.
          </Callout>
        ) : null}
        {state === 'disabled' && !diagnostics?.configurationError ? (
          <Callout tone="neutral" title="AI IS OFF">
            No provider is configured on this deployment. Set AI_PROVIDER to enable JAVE AI.
          </Callout>
        ) : null}
        <FactList facts={facts} />
      </div>
    </Panel>
  );
}

export interface AiLimits {
  enabled: boolean;
  dailyLimit: number;
  maxInputChars: number;
  proposalTtlMinutes: number;
}

/** The limits every member works within (settings.ai and the deployment ceiling). */
export function LimitsPanel({ limits }: { limits: AiLimits }) {
  const facts: Fact[] = [
    { label: 'AI SETTING', value: limits.enabled ? 'Enabled' : 'Disabled in settings' },
    { label: 'DAILY LIMIT', value: `${formatCount(limits.dailyLimit)} requests per member` },
    { label: 'INPUT LIMIT', value: `${formatCount(limits.maxInputChars)} characters` },
    { label: 'PROPOSALS EXPIRE', value: `${limits.proposalTtlMinutes} min after drafting` },
  ];
  return (
    <Panel title="Limits">
      <FactList facts={facts} />
    </Panel>
  );
}
