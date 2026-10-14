/**
 * Game-agnostic authority loop. Validates that an incoming action was actually
 * offered by the ruleset for this player, applies it via the ruleset, and stamps
 * the winner. Copy verbatim between games.
 */

import type { GameState } from "../game/GameState.js";
import type { GameAction } from "../actions/GameAction.js";
import type { RuleSet } from "../rules/RuleSet.js";
import { GameRuleViolationError } from "../rules/GameRuleViolationError.js";
import type { Card } from "../card/Card.js";

/** Never enumerated in listLegalActions (amounts/targets are free-form); validated in applyAction. */
const UNENUMERATED_TYPES = ["manual_action"];
/**
 * Types NOT restricted to the turn player — the ruleset's listLegalActions
 * still gates them field-for-field. play_card is here so a ruleset can offer
 * off-turn casts (ManaWeave: Reaction spells join the shared spell stack);
 * mulligan is here because both weavers decide their opening hand at once.
 */
const TURN_UNGATED_TYPES = ["concede", "manual_action", "play_card", "mulligan"];

function normalizeThreads(ids: readonly string[] | undefined): string {
  return [...(ids ?? [])].sort().join(",");
}

export function isSameActionSignature(a: GameAction, b: GameAction): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "play_card": {
      const other = b as typeof a;
      return (
        a.cardId === other.cardId &&
        normalizeThreads(a.threadIds) === normalizeThreads(other.threadIds) &&
        (a.laneIndex ?? null) === (other.laneIndex ?? null) &&
        (a.row ?? null) === (other.row ?? null) &&
        (a.targetCardId ?? null) === (other.targetCardId ?? null) &&
        (a.targetThreadId ?? null) === (other.targetThreadId ?? null) &&
        (a.targetDirection ?? null) === (other.targetDirection ?? null)
      );
    }
    case "move_unit":
    case "attack": {
      const other = b as typeof a;
      return a.cardId === other.cardId;
    }
    case "weave_thread": {
      const other = b as typeof a;
      return a.threadId === other.threadId && a.direction === other.direction;
    }
    case "mulligan": {
      const other = b as typeof a;
      return [...a.cardIds].sort().join(",") === [...other.cardIds].sort().join(",");
    }
    case "advance_phase":
    case "end_turn":
    case "concede":
      return true;
    default:
      return false;
  }
}

export class BattleEngine {
  constructor(private readonly ruleSet: RuleSet) {}

  createNewGame(
    gameId: string,
    playerDecks: Record<string, readonly Card[]>,
    playerNames?: Record<string, string>,
    playerLooms?: Record<string, readonly string[]>,
  ): GameState {
    for (const [playerId, deck] of Object.entries(playerDecks)) {
      const v = this.ruleSet.validateDeck(deck);
      if (!v.ok) throw new GameRuleViolationError(`Deck for ${playerId} invalid: ${v.reason}`);
    }
    return this.ruleSet.initializeGame(gameId, playerDecks, playerNames, playerLooms as never);
  }

  submitAction(state: GameState, action: GameAction): GameState {
    if (state.winnerPlayerId) throw new GameRuleViolationError("Game is already finished.");
    if (TURN_UNGATED_TYPES.indexOf(action.type) < 0 && action.playerId !== state.turnPlayerId) {
      throw new GameRuleViolationError("Only the active player can take this action.");
    }
    if (!state.players[action.playerId]) {
      throw new GameRuleViolationError("Unknown player.");
    }
    if (UNENUMERATED_TYPES.indexOf(action.type) < 0) {
      const legal = this.ruleSet.listLegalActions(state, action.playerId);
      if (!legal.some((c) => isSameActionSignature(c, action))) {
        throw new GameRuleViolationError("Action is not legal in the current game state.");
      }
    }
    const next = this.ruleSet.applyAction(state, action);
    const winner = this.ruleSet.getWinner(next);
    return winner ? { ...next, winnerPlayerId: winner } : next;
  }
}
