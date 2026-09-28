/**
 * MOCK / DEVELOPMENT ONLY — the standalone dev bar.
 *
 * Shown only outside Discord. It names the mock mode plainly and lets a
 * developer pick the dev persona (the dashboard refuses dev tokens unless
 * JAVE_DEV_AUTH=true outside production). Switching persona reloads the page
 * with the persona in the URL, so two browser windows can be two players.
 */
import { useEffect, useState } from 'react';
import { Badge, NativeSelect } from '@jave/ui';
import type { ApiClient } from '../api/client';
import type { DevPersonaSummary, DevPersonasResponse } from '../api/contract';

export interface DevBarProps {
  api: ApiClient;
  persona: string;
  instanceId: string;
}

function switchPersona(persona: string, instanceId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('persona', persona);
  url.searchParams.set('instance', instanceId);
  window.location.assign(url.toString());
}

export function DevBar({ api, persona, instanceId }: DevBarProps) {
  const [personas, setPersonas] = useState<DevPersonaSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .request<DevPersonasResponse>('GET', '/activity/dev-token')
      .then((result) => {
        if (!cancelled) setPersonas(result.personas);
      })
      .catch(() => {
        // Dev auth is off: the sign-in screen explains it; keep the current persona listed.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const options = personas.some((entry) => entry.key === persona)
    ? personas.map((entry) => ({ value: entry.key, label: entry.label }))
    : [{ value: persona, label: persona }];

  return (
    <aside
      aria-label="Development mode"
      data-testid="dev-bar"
      className="flex items-center gap-x-4 border-b border-warning/30 bg-warning/6 px-4 py-2 sm:px-6"
    >
      <Badge tone="warning">MOCK / DEVELOPMENT ONLY</Badge>
      <p className="hidden text-small text-fg-muted md:block">
        Standalone mode. Mock Discord client, dev persona sign-in.
      </p>
      <div className="ml-auto flex items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="type-eyebrow sr-only text-fg-subtle sm:not-sr-only">PERSONA</span>
          <NativeSelect
            size="sm"
            className="w-32 sm:w-36"
            value={persona}
            options={options}
            onChange={(event) => switchPersona(event.target.value, instanceId)}
          />
        </label>
        <span className="hidden items-center gap-2 sm:flex">
          <span className="type-eyebrow text-fg-subtle">INSTANCE</span>
          <span className="type-data text-small text-fg-muted">{instanceId}</span>
        </span>
      </div>
    </aside>
  );
}
