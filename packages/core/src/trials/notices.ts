import { MINUTE } from '../kernel/clock';
import { SCORE_MAX, trialRef } from './constants';
import type { IncompleteReason, TrialOutcome } from './scoring';
import { formatRemaining, formatUtc } from './timing';

/**
 * User-facing copy for trial notifications. Concise, precise, calm. Kept in
 * one place so the voice stays consistent across DMs and the dashboard inbox.
 */

export interface NoticeTrial {
  number: number;
  title: string;
}

export interface Notice {
  title: string;
  body: string;
}

const SCORE_FRACTION_DIGITS = 2;

function head(trial: NoticeTrial): string {
  return `${trialRef(trial)} — ${trial.title}`;
}

export function formatScore(score: number): string {
  return `${score.toFixed(SCORE_FRACTION_DIGITS)} / ${SCORE_MAX}`;
}

export const notices = {
  selected(trial: NoticeTrial, teamName: string, isLead: boolean): Notice {
    return {
      title: 'TRIAL SELECTION',
      body: `${head(trial)}. You are in ${teamName}${isLead ? ' as team lead' : ''}. The brief unseals when the trial starts.`,
    };
  },

  removed(trial: NoticeTrial): Notice {
    return {
      title: 'TRIAL SELECTION',
      body: `${head(trial)}. You no longer meet the participation requirements, so you were taken off the roster.`,
    };
  },

  waitlisted(trial: NoticeTrial): Notice {
    return {
      title: 'TRIAL SELECTION',
      body: `${head(trial)}. Not selected this round — you remain on the waitlist.`,
    };
  },

  starting(trial: NoticeTrial, teamName: string, deadlineAt: Date): Notice {
    return {
      title: 'TRIAL LIVE',
      body: `${head(trial)} is live. ${teamName}. Deadline ${formatUtc(deadlineAt)}. The brief is in your team channel.`,
    };
  },

  warning(trial: NoticeTrial, minutes: number, deadlineAt: Date): Notice {
    const remaining = formatRemaining(minutes * MINUTE);
    return {
      title: `TRIAL DEADLINE — ${remaining.toUpperCase()}`,
      body: `${head(trial)}. ${remaining} remain. Deadline ${formatUtc(deadlineAt)}. A resubmission replaces your team's earlier version.`,
    };
  },

  extended(trial: NoticeTrial, deadlineAt: Date, reason: string): Notice {
    return {
      title: 'DEADLINE EXTENDED',
      body: `${head(trial)}. New deadline ${formatUtc(deadlineAt)}. ${reason}`,
    };
  },

  closed(trial: NoticeTrial): Notice {
    return {
      title: 'SUBMISSIONS CLOSED',
      body: `${head(trial)}. Submissions are closed. Evaluation in progress.`,
    };
  },

  autoStartSkipped(trial: NoticeTrial, reason: string): Notice {
    return {
      title: 'SCHEDULED START SKIPPED',
      body: `${head(trial)} did not start on schedule. ${reason} Start it by hand or reschedule.`,
    };
  },

  evaluationRequested(trial: NoticeTrial, submitted: number, teams: number): Notice {
    return {
      title: 'EVALUATION READY',
      body: `${head(trial)}. ${submitted} of ${teams} teams submitted. Scoring is open.`,
    };
  },

  result(
    trial: NoticeTrial,
    outcome: TrialOutcome,
    finalScore: number | null,
    passThreshold: number,
    incompleteReason: IncompleteReason | null,
  ): Notice {
    const title = `TRIAL RESULT — ${outcome.toUpperCase()}`;
    if (outcome === 'incomplete' || finalScore === null) {
      const why =
        incompleteReason === 'no_submission'
          ? 'your team did not submit'
          : 'no assessable evaluation was recorded';
      return { title, body: `${head(trial)}. INCOMPLETE — ${why}.` };
    }
    if (outcome === 'fail') {
      return {
        title,
        body: `${head(trial)}. Not passed — ${formatScore(finalScore)} against a pass mark of ${passThreshold.toFixed(SCORE_FRACTION_DIGITS)}.`,
      };
    }
    return {
      title,
      body: `${head(trial)}. ${outcome.toUpperCase()} — ${formatScore(finalScore)}.`,
    };
  },

  cancelled(trial: NoticeTrial, reason: string): Notice {
    return { title: 'TRIAL CANCELLED', body: `${head(trial)} was cancelled. ${reason}` };
  },
} as const;
