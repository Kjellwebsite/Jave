import { useState } from 'react';
import { Radio, Swords } from 'lucide-react';
import { Button, Card, Emblem, EmptyState } from '@jave/ui';
import type { ArenaDifficultyWire, TriviaConfigWire } from '../../api/contract';
import { Segmented } from '../../components/segmented';
import {
  DEFAULT_ROUND_COUNT,
  difficultyChoices,
  effectiveDifficulty,
  fitRounds,
  maxRoundsAt,
  roundChoices,
  type RoundCount,
} from '../../lib/lobby';
import { DEFAULT_PACE, PACE_CHOICES, type PaceChoice, SCORING_NOTE } from './copy';

export interface OpenLobbyProps {
  canHost: boolean;
  /** What the server says a lobby can be opened with (the question bank decides). */
  difficulties: ArenaDifficultyWire[];
  opening: boolean;
  onOpen: (config: TriviaConfigWire) => void;
}

/**
 * Nothing is live in this Activity. Hosts pick the settings and open a
 * lobby; everyone else waits here and the lobby appears on its own. Only
 * combinations the server can fill are selectable.
 */
export function OpenLobby({ canHost, difficulties, opening, onOpen }: OpenLobbyProps) {
  const [chosenRounds, setRounds] = useState<RoundCount>(DEFAULT_ROUND_COUNT);
  const [pace, setPace] = useState<PaceChoice>(DEFAULT_PACE);
  const [chosenDifficulty, setDifficulty] = useState<string | null>(null);
  const difficulty = effectiveDifficulty(difficulties, chosenDifficulty);
  const maxRounds = maxRoundsAt(difficulties, difficulty);
  const rounds = fitRounds(chosenRounds, maxRounds);

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
            if (difficulty !== null && rounds !== null) {
              onOpen({ rounds, secondsPerQuestion: pace, difficulty });
            }
          }}
        >
          <Segmented
            label="ROUNDS"
            value={rounds ?? chosenRounds}
            options={roundChoices(maxRounds)}
            onChange={setRounds}
          />
          <Segmented
            label="TIME PER QUESTION"
            value={pace}
            options={PACE_CHOICES}
            onChange={setPace}
          />
          <Segmented
            label="DIFFICULTY"
            value={difficulty ?? ''}
            options={difficultyChoices(difficulties)}
            onChange={setDifficulty}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            iconLeft={Swords}
            loading={opening}
            disabled={difficulty === null || rounds === null}
            className="w-full"
          >
            Open lobby
          </Button>
        </form>
      </div>
    </section>
  );
}
