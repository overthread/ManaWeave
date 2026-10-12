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

export interface StoredAccount {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: number;
}

/**
 * Account registry behind the login system. Deliberately simple (no password
 * resets, no email): usernames are unique case-insensitively and passwords are
 * stored as unsalted sha256 — this is playtest-grade auth, not production.
 */
export interface AccountStore {
  register(input: { username: string; password: string; displayName?: string }): Promise<StoredAccount>;
  findByUsername(username: string): Promise<StoredAccount | undefined>;
  findById(id: string): Promise<StoredAccount | undefined>;
  close(): Promise<void>;
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
