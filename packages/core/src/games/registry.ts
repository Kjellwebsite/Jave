import { NotFoundError } from '../kernel/errors';
import { reaction } from './reaction/reaction';
import { trivia } from './trivia/trivia';
import type { AnyGameDefinition, GameDefinition, GameSummary } from './types';

const GAME_KEY = /^[a-z][a-z0-9_-]{1,31}$/;

/**
 * Game registry. Definitions are code, like the capability catalog: built-in
 * games register at module load and extensions call `registerGame` once at
 * startup (before any session references their key).
 */
const registry = new Map<string, AnyGameDefinition>();

export function registerGame<Config, State, Move, PublicState>(
  definition: GameDefinition<Config, State, Move, PublicState>,
): void {
  if (!GAME_KEY.test(definition.key)) throw new Error(`invalid game key ${definition.key}`);
  if (registry.has(definition.key)) throw new Error(`game ${definition.key} already registered`);
  if (
    !Number.isInteger(definition.minPlayers) ||
    definition.minPlayers < 1 ||
    definition.maxPlayers < definition.minPlayers
  ) {
    throw new Error(`game ${definition.key} has an invalid player range`);
  }
  registry.set(definition.key, definition);
}

export function findGame(key: string): AnyGameDefinition | null {
  return registry.get(key) ?? null;
}

export function getGame(key: string): AnyGameDefinition {
  const game = findGame(key);
  if (!game) throw new NotFoundError('Game');
  return game;
}

export function listGames(): GameSummary[] {
  return [...registry.values()].map((game) => ({
    key: game.key,
    name: game.name,
    description: game.description,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
  }));
}

registerGame(trivia);
registerGame(reaction);
