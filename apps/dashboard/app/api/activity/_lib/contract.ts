/**
 * The Activity API wire contract: what `/api/activity/*` returns and accepts.
 *
 * TYPES ONLY, NO IMPORTS. The Discord Activity (`apps/activity`) imports this
 * file with `import type` through its `@jave/activity-contract` path alias, so
 * nothing here may ever carry runtime code. Every response is built by an
 * explicit mapper from core views (whitelist), never by spreading a record.
 * Timestamps are epoch milliseconds (server clock); `serverNow` lets the client
 * correct for clock skew.
 */

export interface ActivityErrorBody {
  error: {
    code: string;
    message: string;
    /** `E-XXXXXXXX` for unexpected failures; matches the server log line. */
    reference?: string;
    retryAfterSeconds?: number;
  };
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface ActivityTokenRequest {
  /** OAuth2 authorization code from `commands.authorize`. */
  code: string;
  /** `discordSdk.instanceId`. The issued token is bound to it. */
  instanceId: string;
}

export interface ActivityTokenResponse {
  /** Discord access token, handed back for `commands.authenticate`. Never stored by JAVE. */
  access_token: string | null;
  /** Short-lived JAVE bearer token bound to user + Activity instance. */
  jave_token: string;
  expiresAt: number;
  user: { discordId: string; displayName: string };
  mode: ActivityAuthMode;
}

export type ActivityAuthMode = 'discord' | 'dev';

/** MOCK / DEVELOPMENT ONLY. */
export interface DevPersonaSummary {
  key: string;
  label: string;
  description: string;
}

/** MOCK / DEVELOPMENT ONLY. */
export interface DevPersonasResponse {
  personas: DevPersonaSummary[];
}

/** MOCK / DEVELOPMENT ONLY. */
export interface DevTokenRequest {
  persona: string;
  instanceId: string;
}

// ─── Mission Control ───────────────────────────────────────────────────────

export type RankStatusWire = 'verified' | 'claimed' | 'unknown';

export interface FacetRankWire {
  key: string;
  label: string;
  verifiedRank: string | null;
  claimedRank: string | null;
  status: RankStatusWire;
}

export interface DomainRankWire {
  key: string;
  label: string;
  /** Peak verified facet rank. Never an aggregate across domains. */
  verifiedRank: string | null;
  claimedRank: string | null;
  status: RankStatusWire;
  facets: FacetRankWire[];
}

export interface ProfileStatsWire {
  trials: number;
  trialsPassed: number;
  projects: number;
  projectsShipped: number;
  contributions: number;
  missionsCompleted: number;
  achievements: number;
}

export interface ProfileWire {
  displayName: string;
  handle: string;
  headline: string | null;
  primaryRole: string | null;
  isVerifiedMember: boolean;
  primaryDomain: string | null;
  domains: DomainRankWire[];
  stats: ProfileStatsWire;
}

export interface MissionWire {
  assignmentId: string;
  number: string;
  title: string;
  type: string;
  /** Assignment status: assigned · accepted · submitted · rejected. */
  status: string;
  dueAt: number | null;
}

export interface TrialWire {
  ref: string;
  title: string;
  category: string;
  status: string;
  phase: 'not_started' | 'open' | 'grace' | 'closed';
  scheduledStartAt: number | null;
  startedAt: number | null;
  deadlineAt: number | null;
  closesAt: number | null;
  teamName: string | null;
}

export interface EventWire {
  id: string;
  title: string;
  kind: string;
  status: string;
  startsAt: number;
  endsAt: number;
  location: { kind: 'channel' | 'url' | 'text'; label: string } | null;
  myRsvp: string | null;
}

export interface MissionControlResponse {
  serverNow: number;
  /** Null when the account has no JAVELIN profile yet. */
  profile: ProfileWire | null;
  /** The active missions due soonest (at most five); the dashboard lists the rest. */
  missions: MissionWire[];
  /** How many missions are active in all (`missions` may show fewer). */
  missionsTotal: number;
  /** The member's running (or next scheduled) trial. Never adversarial information. */
  trial: TrialWire | null;
  events: EventWire[];
  canHostGames: boolean;
}

// ─── JVLN Arena · Trivia ───────────────────────────────────────────────────

export type ArenaStatus = 'lobby' | 'active' | 'completed' | 'abandoned';
export type TriviaPhaseWire = 'pending' | 'question' | 'reveal' | 'finished';

export interface ArenaPlayerWire {
  /** Seat-based key (`p1`, `p2`, …): stable for a session, reveals no account id. */
  key: string;
  displayName: string;
  isYou: boolean;
  isHost: boolean;
  /** Final values once the session completes. */
  score: number | null;
  placement: number | null;
}

export interface TriviaScoreWire {
  playerKey: string;
  displayName: string;
  isYou: boolean;
  score: number;
  placement: number;
  answered: boolean;
  /** Null until the round closes. */
  correct: boolean | null;
}

export interface TriviaViewWire {
  phase: TriviaPhaseWire;
  round: number;
  totalRounds: number;
  secondsPerQuestion: number;
  openedAt: number | null;
  closesAt: number | null;
  revealUntil: number | null;
  question: { prompt: string; options: string[]; category: string; difficulty: string } | null;
  /** Null while the question is open. */
  correctIndex: number | null;
  fact: string | null;
  answeredCount: number;
  playerCount: number;
  scoreboard: TriviaScoreWire[];
  you: {
    answered: boolean;
    choice: number | null;
    correct: boolean | null;
    points: number | null;
  } | null;
}

export interface TriviaConfigWire {
  rounds: number;
  secondsPerQuestion: number;
  difficulty: string;
}

export interface ArenaSessionWire {
  id: string;
  status: ArenaStatus;
  version: number;
  gameName: string;
  isHost: boolean;
  youArePlayer: boolean;
  /** You may start it now: host (or event staff) of a lobby with enough players. */
  canStart: boolean;
  /** You may close the lobby: its host, or event staff. */
  canClose: boolean;
  /** You may join it now (open lobby with a free seat). */
  canJoin: boolean;
  /** Fewer than two players: practice, never ranked. */
  practice: boolean;
  minPlayers: number;
  maxPlayers: number;
  config: TriviaConfigWire;
  players: ArenaPlayerWire[];
  trivia: TriviaViewWire | null;
  endReason: string | null;
}

/**
 * A difficulty a lobby can be opened with. Only difficulties the question bank
 * can fill for the minimum round count are listed.
 */
export interface ArenaDifficultyWire {
  /** `mixed`, or a question difficulty (`easy`, `medium`, `hard`). */
  value: string;
  /** Most rounds the bank can fill at this difficulty (never above the engine's maximum). */
  maxRounds: number;
}

export interface ArenaResponse {
  serverNow: number;
  session: ArenaSessionWire | null;
  /** The instance's lobby/active session right now (may differ from `session` once it ended). */
  liveSessionId: string | null;
  /** You may open a lobby (canHostGames, good standing). */
  canHost: boolean;
  /** What the Open Lobby form may offer: every listed choice opens a lobby. */
  difficulties: ArenaDifficultyWire[];
}

export interface ArenaBoardEntryWire {
  /** Competition rank over the rows the viewer may see (ties share a rank; hidden rows leave no gap). */
  rank: number;
  displayName: string;
  isYou: boolean;
  wins: number;
  bestScore: number;
  sessions: number;
}

/**
 * The all-time trivia board, exactly as core's leaderboard shows it to this
 * viewer: ranked games only, opted-in members in good standing, and never a
 * profile the viewer could not open.
 */
export interface ArenaBoardResponse {
  serverNow: number;
  gameName: string;
  entries: ArenaBoardEntryWire[];
}

export interface ArenaOpenRequest {
  config?: Partial<TriviaConfigWire>;
}

export interface ArenaSessionRequest {
  sessionId: string;
}

export interface ArenaMoveRequest {
  sessionId: string;
  round: number;
  choice: number;
}
