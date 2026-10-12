/**
 * Postgres persistence behind the AccountStore / AsyncPlayerDeckStore ports.
 * Activated by DATABASE_URL — built for free-tier cloud Postgres (Neon,
 * Supabase, ...) so accounts, decks and the auth secret survive container
 * restarts, redeploys and spin-downs on hosts with ephemeral filesystems.
 * Behaviour mirrors the JSON stores (JsonAccountStore / JsonDeckStore).
 */

import crypto from "node:crypto";
import pg from "pg";
import type { AccountStore, AsyncPlayerDeckStore, StoredAccount, StoredDeck, StoredDeckCard, StoredPlayer } from "../../application/ports.js";
import type { ThreadColour } from "../../domain/card/Card.js";
import type { PoolClient } from "pg";
import { hashPassword } from "./passwords.js";
import { sanitizeLoom, sanitizeCards } from "./JsonDeckStore.js";

interface AccountRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  created_at: number;
}

interface PlayerRow {
  id: string;
  display_name: string;
  created_at: number;
}

interface DeckRow {
  id: string;
  player_id: string;
  name: string;
  format: string;
  loom: string[];
  created_at: number;
  updated_at: number;
}

interface DeckCardRow {
  deck_id: string;
  card_def_id: string;
  quantity: number;
}

function rowToAccount(row: AccountRow): StoredAccount {
  return { id: row.id, username: row.username, displayName: row.display_name, passwordHash: row.password_hash, createdAt: Number(row.created_at) };
}

function rowToPlayer(row: PlayerRow): StoredPlayer {
  return { id: row.id, displayName: row.display_name, createdAt: Number(row.created_at) };
}

function rowToDeck(row: DeckRow, cards: StoredDeckCard[]): StoredDeck {
  return {
    id: row.id,
    playerId: row.player_id,
    name: row.name,
    format: row.format,
    loom: row.loom as ThreadColour[],
    cards,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS players (
     id TEXT PRIMARY KEY,
     display_name TEXT NOT NULL,
     created_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS decks (
     id TEXT PRIMARY KEY,
     player_id TEXT NOT NULL,
     name TEXT NOT NULL,
     format TEXT NOT NULL DEFAULT 'standard',
     loom TEXT[] NOT NULL DEFAULT '{}',
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS deck_cards (
     deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
     card_def_id TEXT NOT NULL,
     quantity INT NOT NULL,
     PRIMARY KEY (deck_id, card_def_id)
   )`,
  `CREATE INDEX IF NOT EXISTS decks_by_player ON decks (player_id)`,
  `CREATE TABLE IF NOT EXISTS accounts (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL,
     display_name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     created_at BIGINT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_lower ON accounts (lower(username))`,
  `CREATE TABLE IF NOT EXISTS app_secrets (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
];

async function loadCardsFor(client: PoolClient | pg.Pool, deckIds: string[]): Promise<Map<string, StoredDeckCard[]>> {
  const byDeck = new Map<string, StoredDeckCard[]>();
  if (deckIds.length === 0) return byDeck;
  const result = await client.query<DeckCardRow>(
    `SELECT deck_id, card_def_id, quantity FROM deck_cards WHERE deck_id = ANY($1) ORDER BY card_def_id`,
    [deckIds],
  );
  for (const row of result.rows) {
    const list = byDeck.get(row.deck_id) ?? [];
    list.push({ cardDefId: row.card_def_id, quantity: Number(row.quantity) });
    byDeck.set(row.deck_id, list);
  }
  return byDeck;
}

export class PostgresAccountStore implements AccountStore {
  constructor(private readonly pool: pg.Pool) {}

  async register(input: { username: string; password: string; displayName?: string }): Promise<StoredAccount> {
    const username = input.username.trim().slice(0, 40);
    try {
      const result = await this.pool.query<AccountRow>(
        `INSERT INTO accounts (id, username, display_name, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, username, display_name, password_hash, created_at`,
        [crypto.randomUUID(), username, (input.displayName?.trim() || username).slice(0, 40), hashPassword(username, input.password), Date.now()],
      );
      return rowToAccount(result.rows[0]!);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new Error("That username is already taken.");
      throw err;
    }
  }

  async findByUsername(username: string): Promise<StoredAccount | undefined> {
    const result = await this.pool.query<AccountRow>(
      `SELECT id, username, display_name, password_hash, created_at FROM accounts WHERE lower(username) = lower($1)`,
      [username.trim()],
    );
    return result.rows[0] ? rowToAccount(result.rows[0]) : undefined;
  }

  async findById(id: string): Promise<StoredAccount | undefined> {
    const result = await this.pool.query<AccountRow>(
      `SELECT id, username, display_name, password_hash, created_at FROM accounts WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? rowToAccount(result.rows[0]) : undefined;
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}

export class PostgresDeckStore implements AsyncPlayerDeckStore {
  constructor(private readonly pool: pg.Pool) {}

  async upsertPlayer(input: { id?: string; name?: string }): Promise<StoredPlayer> {
    const id = input.id && input.id.trim() ? input.id.trim().slice(0, 40) : crypto.randomUUID();
    const displayName = (input.name ?? "Weaver").trim().slice(0, 40) || "Weaver";
    const result = await this.pool.query<PlayerRow>(
      `INSERT INTO players (id, display_name, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET display_name = COALESCE(NULLIF($4, ''), players.display_name)
       RETURNING id, display_name, created_at`,
      [id, displayName, Date.now(), input.name?.trim().slice(0, 40) ?? ""],
    );
    return rowToPlayer(result.rows[0]!);
  }

  async getPlayerById(id: string): Promise<StoredPlayer | undefined> {
    const result = await this.pool.query<PlayerRow>(
      `SELECT id, display_name, created_at FROM players WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? rowToPlayer(result.rows[0]) : undefined;
  }

  async listDecksByPlayer(playerId: string): Promise<StoredDeck[]> {
    const result = await this.pool.query<DeckRow>(
      `SELECT id, player_id, name, format, loom, created_at, updated_at FROM decks WHERE player_id = $1 ORDER BY updated_at DESC`,
      [playerId],
    );
    const cards = await loadCardsFor(this.pool, result.rows.map((r) => r.id));
    return result.rows.map((row) => rowToDeck(row, cards.get(row.id) ?? []));
  }

  async getDeckByIdForPlayer(playerId: string, deckId: string): Promise<StoredDeck | undefined> {
    const result = await this.pool.query<DeckRow>(
      `SELECT id, player_id, name, format, loom, created_at, updated_at FROM decks WHERE id = $1 AND player_id = $2`,
      [deckId, playerId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const cards = await loadCardsFor(this.pool, [row.id]);
    return rowToDeck(row, cards.get(row.id) ?? []);
  }

  async saveDeck(input: { playerId: string; name: string; format?: string; loom: ThreadColour[]; cards: StoredDeckCard[]; deckId?: string }): Promise<StoredDeck> {
    const now = Date.now();
    const name = input.name.trim().slice(0, 60);
    const loom = sanitizeLoom(input.loom);
    // Merge duplicate card entries — the (deck_id, card_def_id) primary key
    // holds one row per definition.
    const merged = new Map<string, number>();
    for (const c of sanitizeCards(input.cards)) merged.set(c.cardDefId, Math.min(20, (merged.get(c.cardDefId) ?? 0) + c.quantity));
    const cards = [...merged.entries()].map(([cardDefId, quantity]) => ({ cardDefId, quantity }));
    const client = await this.pool.connect();
    let deckId: string | undefined;
    try {
      await client.query("BEGIN");
      if (input.deckId) {
        const updated = await client.query(
          `UPDATE decks SET name = COALESCE(NULLIF($1, ''), decks.name), format = COALESCE($2, decks.format), loom = $3, updated_at = $4
           WHERE id = $5 AND player_id = $6
           RETURNING id`,
          [name, input.format ?? null, loom, now, input.deckId, input.playerId],
        );
        deckId = updated.rows[0]?.id as string | undefined;
      }
      if (!deckId) {
        const inserted = await client.query(
          `INSERT INTO decks (id, player_id, name, format, loom, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           RETURNING id`,
          [crypto.randomUUID(), input.playerId, name || "Untitled pattern", input.format ?? "standard", loom, now],
        );
        deckId = inserted.rows[0]!.id as string;
      }
      await client.query(`DELETE FROM deck_cards WHERE deck_id = $1`, [deckId]);
      if (cards.length > 0) {
        const values: unknown[] = [];
        const tuples = cards.map((c, i) => {
          values.push(deckId, c.cardDefId, c.quantity);
          return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
        });
        await client.query(`INSERT INTO deck_cards (deck_id, card_def_id, quantity) VALUES ${tuples.join(", ")}`, values);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    const saved = await this.getDeckByIdForPlayer(input.playerId, deckId!);
    if (!saved) throw new Error("Deck save could not be read back.");
    return saved;
  }

  async deleteDeck(playerId: string, deckId: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM decks WHERE id = $1 AND player_id = $2 RETURNING id`, [deckId, playerId]);
    return result.rows.length > 0;
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}

/**
 * Auth-token secret kept in Postgres so bearer tokens stay valid across
 * restarts when DATABASE_URL is set (replaces DATA_DIR/auth-secret).
 */
export async function loadOrCreatePostgresSecret(pool: pg.Pool): Promise<string> {
  const candidate = crypto.randomBytes(32).toString("hex");
  await pool.query(`INSERT INTO app_secrets (key, value) VALUES ('auth-secret', $1) ON CONFLICT (key) DO NOTHING`, [candidate]);
  const result = await pool.query<{ value: string }>(`SELECT value FROM app_secrets WHERE key = 'auth-secret'`);
  return result.rows[0]?.value ?? candidate;
}

export async function createPostgresStores(databaseUrl: string): Promise<{ pool: pg.Pool; accountStore: PostgresAccountStore; deckStore: PostgresDeckStore }> {
  // Managed free-tier Postgres (Neon/Supabase) speaks TLS, often with a
  // non-standard CA — accept it (playtest-grade, matches the auth posture).
  const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  pg.types.setTypeParser(20, Number); // BIGINT timestamps -> JS numbers
  for (const migration of MIGRATIONS) await pool.query(migration);
  return { pool, accountStore: new PostgresAccountStore(pool), deckStore: new PostgresDeckStore(pool) };
}
