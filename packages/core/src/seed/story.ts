import type { SeedRun } from './run';

/**
 * The seed's timeline. Chapters register beats at story times (days relative
 * to the anchor, plus an hour of the day); `play` runs them in time order, so
 * chapters about different domains interleave the way real history does.
 * Beats at the same instant run in registration order. A beat that lets time
 * pass (`run.later`) may delay the next one slightly; the clock never moves
 * backwards.
 */

export type Beat = (run: SeedRun) => Promise<void>;

interface ScheduledBeat {
  days: number;
  hours: number;
  order: number;
  beat: Beat;
}

export class Story {
  private readonly beats: ScheduledBeat[] = [];

  /**
   * Schedule `beat` on day `days` (0 is the anchor's day, negative is earlier)
   * at `hours` UTC. Beats must fall before the anchor.
   */
  at(days: number, hours: number, beat: Beat): void {
    this.beats.push({ days, hours, order: this.beats.length, beat });
  }

  async play(run: SeedRun): Promise<void> {
    const timed = this.beats.map((beat) => ({ ...beat, due: run.time(beat.days, beat.hours) }));
    timed.sort((a, b) => a.due.getTime() - b.due.getTime() || a.order - b.order);
    for (const { due, beat } of timed) {
      if (due.getTime() > run.anchor.getTime()) {
        throw new Error(`seed beat at ${due.toISOString()} falls after the anchor`);
      }
      if (due.getTime() > run.clock.now().getTime()) await run.advanceTo(due);
      await beat(run);
    }
  }
}
