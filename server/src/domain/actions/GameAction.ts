/**
 * Player intents, one variant per verb. Clients send partials; the server
 * accepts an action only if it matches a `listLegalActions` entry field-for-field.
 * The exception is `manual_action`: card effects and combat damage are resolved
 * by hand, so manual actions are unrestricted — either player, any time — and
 * are validated only in `applyAction` (targets must exist, amounts must be sane).
 * The manual vocabulary covers the effect list in Card.ts plus playtest verbs:
 * exhaust_thread, peek_deck (own deck only), shuffle_deck and move_card
 * (send a card to hand / deck top / deck bottom / discard / purge).
 */

import type { CardEffect } from "../card/Card.js";

export type LaneRow = "front" | "back";
export type WeaveDirection = "cw" | "ccw";

export interface BaseGameAction {
  readonly type: string;
  readonly gameId: string;
  readonly playerId: string;
}

export interface PlayCardAction extends BaseGameAction {
  readonly type: "play_card";
  readonly cardId: string;
  readonly threadIds: readonly string[]; // which threads get exhausted (player choice)
  readonly laneIndex: number | null; // units only
  readonly row: LaneRow | null; // units only
  readonly targetCardId?: string; // targeted spells
  readonly targetThreadId?: string; // thread-targeted spells
  readonly targetDirection?: WeaveDirection; // rotate_thread spells
}

export interface MoveUnitAction extends BaseGameAction {
  readonly type: "move_unit";
  readonly cardId: string;
}

export interface AttackAction extends BaseGameAction {
  readonly type: "attack";
  readonly cardId: string;
}

export interface WeaveThreadAction extends BaseGameAction {
  readonly type: "weave_thread";
  readonly threadId: string;
  readonly direction: WeaveDirection;
}

export interface AdvancePhaseAction extends BaseGameAction {
  readonly type: "advance_phase";
}

export interface EndTurnAction extends BaseGameAction {
  readonly type: "end_turn";
}

export interface ConcedeAction extends BaseGameAction {
  readonly type: "concede";
}

/** A hand-resolved effect: either weaver may fire it at any time, no restrictions. */
export interface ManualAction extends BaseGameAction {
  readonly type: "manual_action";
  readonly effect: CardEffect; // kind + amount/atk/hp as applicable
  readonly targetCardId?: string; // unit-targeted kinds
  readonly targetPlayerId?: string; // weaver-targeted kinds (damage_face/heal_face/draw/purge_deck_top)
  readonly targetThreadId?: string; // ready_thread / rotate_thread
  readonly targetDirection?: WeaveDirection; // rotate_thread
}

export type GameAction =
  | PlayCardAction
  | MoveUnitAction
  | AttackAction
  | WeaveThreadAction
  | AdvancePhaseAction
  | EndTurnAction
  | ConcedeAction
  | ManualAction;
