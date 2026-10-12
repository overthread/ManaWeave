/**
 * Application ports. Infrastructure provides implementations; use cases depend
 * only on these interfaces.
 */

import type { GameState } from "../domain/game/GameState.js";
import type { GameAction } from "../domain/actions/GameAction.js";
import type { ThreadColour } from "../domain/card/Card.js";

export interface GameRepository {
  save(state: GameState): Promise<void>;
  findById(id: string): Promise<GameState | undefined>;
}

export interface GameEvents {
  gameStarted(state: GameState): Promise<void>;
  actionAccepted(action: GameAction, state: GameState): Promise<void>;
  gameFinished(state: GameState): Promise<void>;
}

export interface StoredDeckCard {
  cardDefId: string;
  quantity: number;
}

export interface StoredDeck {
  id: string;
  playerId: string;
  name: string;
  format: string;
  loom: ThreadColour[];
  cards: StoredDeckCard[];
  createdAt: number;
  updatedAt: number;
}

export interface StoredPlayer {
  id: string;
  displayName: string;
  createdAt: number;
}

export interface AsyncPlayerDeckStore {
  upsertPlayer(input: { id?: string; name?: string }): Promise<StoredPlayer>;
  getPlayerById(id: string): Promise<StoredPlayer | undefined>;
  listDecksByPlayer(playerId: string): Promise<StoredDeck[]>;
  getDeckByIdForPlayer(playerId: string, deckId: string): Promise<StoredDeck | undefined>;
  saveDeck(input: { playerId: string; name: string; format?: string; loom: ThreadColour[]; cards: StoredDeckCard[]; deckId?: string }): Promise<StoredDeck>;
  deleteDeck(playerId: string, deckId: string): Promise<boolean>;
  close(): Promise<void>;
}
