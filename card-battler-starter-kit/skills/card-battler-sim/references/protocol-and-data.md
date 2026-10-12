# Protocol & Data Reference

## REST endpoints

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/health` | liveness | `{ok: true}`; use as deploy health check |
| `GET /api/cards/catalog` | card definitions for deckbuilder | `{categories: string[], cards: CardDefinition[]}` |
| `POST /api/players` | upsert player | body `{id?, name?}` -> stored player |
| `GET/PUT /api/players/:id` | fetch/rename player | |
| `GET /api/players/:id/decks` | list decks | `{player, decks: StoredDeck[]}` |
| `POST /api/players/:id/decks` | create deck | body `{name?, format?, cards: [{cardDefId, quantity}]}`; route-level validation |
| `GET/PUT/DELETE /api/players/:id/decks/:deckId` | deck detail/update/delete | ownership enforced (`getDeckByIdForPlayer`) |
| `POST /api/lobbies` | create room | `{name?}` -> `{roomCode, playerId: "p1", playerKey, lobby}` |
| `GET /api/lobbies/:code` | lobby snapshot | |
| `POST /api/lobbies/:code/join` | take p2 seat | `{name?}` -> `{playerId: "p2", playerKey, lobby}`; 409 if full/started; same-name join returns existing seat (refresh recovery) |
| `POST /api/lobbies/:code/deck-selection` | attach/detach deck to seat | `{playerId, playerKey, deckPlayerId, deckId}`; empty ids clear the selection |
| `POST /api/lobbies/:code/start` | host starts match | requires `playerKey` of host + both seats have decks -> `{gameId, lobby}` |
| `POST /api/games` | direct game create | optional persisted deck ids; fallback demo decks |
| `GET /api/games/:id?playerId=` | sanitized view | |
| `GET /api/games/:id/stream?playerId=` | SSE stream | headers: `text/event-stream`, `no-cache`, `X-Accel-Buffering: no`; sends `ready` + `game_state` |
| `POST /api/games/:id/actions` | submit action | body is partial `GameAction` (gameId from path); -> `{ok, winnerPlayerId}` |

Error convention: handler throws / writes `{error: string}` with 400 (bad input / rule violation), 403 (bad `playerKey`), 404, 409 (lobby full/started).

## WebSocket protocol

One endpoint: `ws(s)://host/ws`

- Game channel: `?gameId=G&playerId=p1`
- Lobby channel: `?mode=lobby&roomCode=R&playerId=p1` (`playerId` optional for spectators)

Validate BEFORE upgrade: game/room must exist and `playerId` must be a seat in it, else `socket.destroy()`. Keep a `Map<channelKey, Set<{playerId?, socket}>>` per channel kind; delete on `close` (drop the map entry when the set empties).

Server -> client frames: `{event: string, payload: unknown}` JSON.

| Event | Payload | When |
|---|---|---|
| `ready` | `{ok, mode, gameId/roomCode, playerId}` | on connect |
| `game_state` | `ClientGameView` | on connect + after every accepted action |
| `lobby_state` | lobby view | on connect + roster/chat/deck-selection/start changes |
| `chat_error` | `{error}` | invalid chat |

Client -> server frames: only `{event: "chat_send", payload: {text}}` (lobby). Game actions deliberately go over REST so each one gets an HTTP status; the resulting state arrives via `game_state` push.

Client resilience pattern (in `app.js`): on `onclose` schedule reconnect in ~900 ms; a new socket immediately receives `ready` + full `game_state`, so recovery needs no client-side resync logic.

## Sanitized client view (`ClientGameView`)

```ts
type PublicPlayerView = {
  id: string; name: string;
  scoreCount: number; scorePile: number[];          // game-specific score display
  deckCount: number; deck: Card[];                  // deck: [] for others; full for viewer
  handCount: number; hand: Card[];                  // others: only revealed cards
  battlefield: Card[];                              // always public
  graveyardCount: number; graveyard: Card[];        // counts only for others
  exileCount: number; exile: Card[];
};
type ClientGameView = {
  gameId: string; turnPlayerId: string; turnNumber: number; phase: string;
  winnerPlayerId?: string;
  players: Record<string, PublicPlayerView>;
  legalActions: readonly GameAction[];              // computed FOR THE VIEWER
};
```

Rules: compute the view per recipient inside the broadcast loop (never one shared payload); the viewer gets their own zones in full; everything else becomes counts; hand reveals come from `metadata.revealedHandByOwner` (a map of ownerId -> revealed instance ids). Add game-specific public data (score piles, combat lanes) at the top level of the view.

## Persistence schema

```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE decks (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, name TEXT NOT NULL, format TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE);
CREATE TABLE deck_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id TEXT NOT NULL, card_def_id TEXT NOT NULL, quantity INTEGER NOT NULL,
  FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE);
CREATE UNIQUE INDEX deck_cards_uq ON deck_cards(deck_id, card_def_id);
```

- Decks are `(cardDefId, quantity 1..N)` rows — never stored card instances.
- `saveDeck` upserts deck row then deletes+reinserts the card rows (simple + correct).
- Ownership check on every read-for-play: `getDeckByIdForPlayer(playerId, deckId)`.
- Factory: `DATABASE_URL` set -> Postgres adapter (`ensureSchema()` on boot), else sqlite file at `DATA_DIR/battlesim.sqlite` (mkdir; tmpdir fallback), both behind one async interface `{upsertPlayer, getPlayerById, listDecksByPlayer, getDeckByIdForPlayer, saveDeck, deleteDeck, close}`.

## Lobby lifecycle

```
create:  POST /api/lobbies -> roomCode (6 chars, unambiguous alphabet, no 0/O/1/I/L), p1 seat, playerKey
join:    POST /api/lobbies/:code/join -> p2 seat, playerKey (409 when full or started)
select:  POST .../deck-selection  (per seat; validated against the player's persisted decks)
start:   POST .../start (host only, playerKey required, both decks present)
         -> StartGameUseCase -> lobby.status="started", lobby.gameId=... -> WS push
         -> both clients navigate to battle page and open game WS channel
```

Lobby state shape: `{roomCode, status: "waiting"|"started", players: [{id: "p1"|"p2", name}], playerSessionKeys, deckSelections: {p1?: {playerProfileId, deckId, deckName, selectedAt}, p2?: ...}, messages: [{id, senderId, senderName, text(<=240), sentAt}] (cap 100), gameId?, createdAt}`.

## Card catalog ingestion

- One env var per category, e.g. `CARD_CSV_SCIENCE_URL`, `CARD_CSV_TOKENS_URL`, ... (categories are game-specific).
- Google Sheets: normalize `/pubhtml` -> `/pub`, force `output=csv&single=true` query params, then `fetch`.
- Parse with a small quoted-CSV parser (handles `""` escapes, newlines inside quotes); normalize headers (`Card ID` -> `card_id`); map row fields tolerantly (`title`|`name`, `power`|`attack`, `intellect`|`health`, `types`|`type`; slug from title when no id).
- Row -> `CardDefinition`; per-category failures log a warning and skip. If nothing loads, the built-in fallback catalog guarantees a playable game.
- Categories get stable colors/symbols for UI rendering (store on the definition).
