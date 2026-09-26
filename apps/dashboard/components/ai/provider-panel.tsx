import { Callout, formatCount, Mono, Panel, StatusBadge } from '@jave/ui';
import { type Fact, FactList } from '@/components/fact-list';
import { PROVIDER_STATE_LABELS, PROVIDER_STATE_TONE } from '@/lib/ai-labels';

export interface ProviderPanelProps {
  state: keyof typeof PROVIDER_STATE_LABELS;
  provider: string;
  model: string;
  /** Operator detail (health text, check time) — only for canViewSystemStatus. */
  diagnostics: { detail: string; checkedAt: string; configurationError: string | null } | null;
  settings: {
    enabled: boolean;
    dailyLimit: number;
    maxInputChars: number;
    proposalTtlMinutes: number;
  };
  isMock: boolean;
}

/** Which provider answers, whether it is reachable, and the limits every member works within. */
export function ProviderPanel({
  state,
  provider,
  model,
  diagnostics,
  settings,
  isMock,
}: ProviderPanelProps) {
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
    { label: 'AI SETTING', value: settings.enabled ? 'Enabled' : 'Disabled in settings' },
    { label: 'DAILY LIMIT', value: `${formatCount(settings.dailyLimit)} requests per member` },
    { label: 'INPUT LIMIT', value: `${formatCount(settings.maxInputChars)} characters` },
    { label: 'PROPOSALS EXPIRE', value: `${settings.proposalTtlMinutes} min after drafting` },
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
