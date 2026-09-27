import { useState } from 'react';
import { Radio, Swords } from 'lucide-react';
import { Button, Card, Emblem, EmptyState } from '@jave/ui';
import type { TriviaConfigWire } from '../../api/contract';
import { Segmented } from '../../components/segmented';
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_PACE,
  DEFAULT_ROUNDS,
  DIFFICULTY_CHOICES,
  type DifficultyChoice,
  PACE_CHOICES,
  type PaceChoice,
  ROUND_CHOICES,
  type RoundChoice,
  SCORING_NOTE,
} from './copy';

export interface OpenLobbyProps {
  canHost: boolean;
  opening: boolean;
  onOpen: (config: TriviaConfigWire) => void;
}

/**
 * Nothing is live in this Activity. Hosts pick the settings and open a
 * lobby; everyone else waits here and the lobby appears on its own.
 */
export function OpenLobby({ canHost, opening, onOpen }: OpenLobbyProps) {
  const [rounds, setRounds] = useState<RoundChoice>(DEFAULT_ROUNDS);
  const [pace, setPace] = useState<PaceChoice>(DEFAULT_PACE);
  const [difficulty, setDifficulty] = useState<DifficultyChoice>(DEFAULT_DIFFICULTY);

  if (!canHost) {
    return (
      <Card data-testid="arena-idle">
        <EmptyState
          icon={Radio}
          title="NO LIVE GAME"
          description="A member with hosting rights opens the lobby. It appears here on its own."
        />
      </Card>
    );
  }

  return (
    <section
      aria-labelledby="arena-open-title"
      className="machined relative overflow-hidden rounded-lg border border-line bg-surface"
      data-testid="arena-open"
    >
      <Emblem
        size={260}
        variant="mono"
        className="pointer-events-none absolute -bottom-16 -left-10 text-fg opacity-[0.03]"
      />
      <div className="relative grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-center">
        <div className="min-w-0 space-y-4">
          <p className="type-eyebrow text-fg-subtle">JVLN ARENA</p>
          <h2 id="arena-open-title" className="type-title text-fg">
            Trivia
          </h2>
          <p className="max-w-md text-body text-fg-muted">
            Logic, mathematics, physics, computer science, engineering history, space and biology.
            Four options, one answer, a clock.
          </p>
          <p className="max-w-md text-small text-fg-subtle">{SCORING_NOTE}</p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onOpen({ rounds, secondsPerQuestion: pace, difficulty });
          }}
        >
          <Segmented label="ROUNDS" value={rounds} options={ROUND_CHOICES} onChange={setRounds} />
          <Segmented
            label="TIME PER QUESTION"
            value={pace}
            options={PACE_CHOICES}
            onChange={setPace}
          />
          <Segmented
            label="DIFFICULTY"
            value={difficulty}
            options={DIFFICULTY_CHOICES}
            onChange={setDifficulty}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            iconLeft={Swords}
            loading={opening}
            className="w-full"
          >
            Open lobby
          </Button>
        </form>
      </div>
    </section>
  );
}
