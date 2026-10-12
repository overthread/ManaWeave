import type { GameState } from "../game/GameState.js";
import type { GameAction } from "../actions/GameAction.js";
import type { Card, ThreadColour } from "../card/Card.js";

/**
 * The game-specific seam. Everything else in the stack is game-agnostic.
 */
export interface RuleSet {
  readonly id: string;
  readonly version: string;

  validateDeck(deck: readonly Card[]): { ok: boolean; reason?: string };

  /** Loom composition check (ManaWeave-specific): 4 threads, colours cover the deck. */
  validateLoom(loom: readonly ThreadColour[], deck: readonly Card[]): { ok: boolean; reason?: string };

  initializeGame(
    gameId: string,
    playerDecks: Record<string, readonly Card[]>,
    playerNames?: Record<string, string>,
    playerLooms?: Record<string, readonly ThreadColour[]>,
  ): GameState;

  listLegalActions(state: GameState, playerId: string): readonly GameAction[];

  applyAction(state: GameState, action: GameAction): GameState;

  getWinner(state: GameState): string | undefined;
}
