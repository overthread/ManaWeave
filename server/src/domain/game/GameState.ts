/**
 * Core game state. Ruleset-owned extras (looms, log, rng, weave & mulligan
 * flags) live in `metadata` behind the parse helpers in the ruleset — never
 * read them directly.
 */

import { Card } from "../card/Card.js";

export type GamePhase = "mulligan" | "main" | "weave";

export interface PlayerState {
  id: string;
  name: string;
  life: number;
  energy: number; // unused by ManaWeave; kept for shell compatibility
  deck: Card[]; // top = index 0
  hand: Card[];
  battlefield: Card[];
  graveyard: Card[]; // discard
  exile: Card[]; // purge
}

export interface GameState {
  gameId: string;
  players: Record<string, PlayerState>;
  turnPlayerId: string;
  turnNumber: number;
  phase: GamePhase;
  winnerPlayerId?: string;
  metadata: Record<string, unknown>;
}
