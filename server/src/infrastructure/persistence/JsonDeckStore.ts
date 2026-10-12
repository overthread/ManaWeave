/**
 * JSON-file deck persistence behind the AsyncPlayerDeckStore port.
 * Zero native dependencies; swap in sqlite/postgres adapters later without
 * touching callers. Data lives at DATA_DIR (default: <server>/data).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AsyncPlayerDeckStore, StoredDeck, StoredDeckCard, StoredPlayer } from "../../application/ports.js";
import type { ThreadColour } from "../../domain/card/Card.js";
import { THREAD_COLOURS } from "../../domain/rules/deckRules.js";

interface StoreFile {
  players: StoredPlayer[];
  decks: StoredDeck[];
}

const emptyStore = (): StoreFile => ({ players: [], decks: [] });

export function sanitizeLoom(value: unknown): ThreadColour[] {
  if (!Array.isArray(value)) return [];
  const out: ThreadColour[] = [];
  for (const v of value) {
    if (typeof v === "string" && (THREAD_COLOURS as readonly string[]).includes(v)) out.push(v as ThreadColour);
  }
  return out;
}

export function sanitizeCards(value: unknown): StoredDeckCard[] {
  if (!Array.isArray(value)) return [];
  const out: StoredDeckCard[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const cardDefId = (v as Record<string, unknown>).cardDefId;
    const quantity = (v as Record<string, unknown>).quantity;
    if (typeof cardDefId !== "string" || typeof quantity !== "number") continue;
    const q = Math.max(0, Math.min(20, Math.floor(quantity)));
    if (q === 0) continue;
    out.push({ cardDefId, quantity: q });
  }
  return out;
}

export class JsonDeckStore implements AsyncPlayerDeckStore {
  private readonly file: string;
  private cache: StoreFile | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "decks.json");
  }

  private async load(): Promise<StoreFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      this.cache = {
        players: Array.isArray(parsed.players) ? parsed.players : [],
        decks: Array.isArray(parsed.decks) ? parsed.decks : [],
      };
    } catch {
      this.cache = emptyStore();
    }
    return this.cache;
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.cache ?? emptyStore(), null, 2);
    this.writing = this.writing.then(() => fs.writeFile(this.file, snapshot, "utf8")).catch(() => undefined);
    return this.writing;
  }

  async upsertPlayer(input: { id?: string; name?: string }): Promise<StoredPlayer> {
    const store = await this.load();
    if (input.id) {
      const existing = store.players.find((p) => p.id === input.id);
      if (existing) {
        if (typeof input.name === "string" && input.name.trim()) existing.displayName = input.name.trim().slice(0, 40);
        await this.persist();
        return existing;
      }
    }
    const player: StoredPlayer = {
      id: input.id && input.id.trim() ? input.id.trim().slice(0, 40) : crypto.randomUUID(),
      displayName: (input.name ?? "Weaver").trim().slice(0, 40) || "Weaver",
      createdAt: Date.now(),
    };
    store.players.push(player);
    await this.persist();
    return player;
  }

  async getPlayerById(id: string): Promise<StoredPlayer | undefined> {
    const store = await this.load();
    return store.players.find((p) => p.id === id);
  }

  async listDecksByPlayer(playerId: string): Promise<StoredDeck[]> {
    const store = await this.load();
    return store.decks.filter((d) => d.playerId === playerId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getDeckByIdForPlayer(playerId: string, deckId: string): Promise<StoredDeck | undefined> {
    const store = await this.load();
    return store.decks.find((d) => d.id === deckId && d.playerId === playerId);
  }

  async saveDeck(input: { playerId: string; name: string; format?: string; loom: ThreadColour[]; cards: StoredDeckCard[]; deckId?: string }): Promise<StoredDeck> {
    const store = await this.load();
    const now = Date.now();
    let deck = input.deckId ? store.decks.find((d) => d.id === input.deckId && d.playerId === input.playerId) : undefined;
    if (!deck) {
      deck = {
        id: crypto.randomUUID(),
        playerId: input.playerId,
        name: input.name.trim().slice(0, 60) || "Untitled pattern",
        format: input.format ?? "standard",
        loom: sanitizeLoom(input.loom),
        cards: sanitizeCards(input.cards),
        createdAt: now,
        updatedAt: now,
      };
      store.decks.push(deck);
    } else {
      deck.name = input.name.trim().slice(0, 60) || deck.name;
      deck.format = input.format ?? deck.format;
      deck.loom = sanitizeLoom(input.loom);
      deck.cards = sanitizeCards(input.cards);
      deck.updatedAt = now;
    }
    await this.persist();
    return deck;
  }

  async deleteDeck(playerId: string, deckId: string): Promise<boolean> {
    const store = await this.load();
    const idx = store.decks.findIndex((d) => d.id === deckId && d.playerId === playerId);
    if (idx < 0) return false;
    store.decks.splice(idx, 1);
    await this.persist();
    return true;
  }

  async close(): Promise<void> {
    await this.writing;
  }
}
