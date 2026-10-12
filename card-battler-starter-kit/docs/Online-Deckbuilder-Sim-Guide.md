# Online Deckbuilder Sim Guide

This document is the end-to-end reference for how GMC TCG Battlesim implements an **online, multiplayer, deckbuilding card battler**, written so the same architecture can be reused to build a brand-new card game. It consolidates what the code actually does today; `OOSD-Architecture.md`, `Ruleset-Integration-Guide.md`, and `Frontend-OOSD-Guide.md` cover individual layers in more depth.

## 1. The shape of the system

One Node.js process serves everything: the game API, the WebSocket transport, the deckbuilder API, card catalog ingestion, and the static browser client. There is no frontend framework and no HTTP framework — the whole stack is `node:http`, `ws`, `better-sqlite3`/`pg` (via drizzle-orm), and TypeScript ESM.

```text
Browser (3 pages, vanilla ES modules)          Server (single Node process)
┌────────────┐  ┌──────────────┐  ┌─────────┐   ┌──────────────────────────────────┐
│ /lobby     │  │ /decks       │  │ /game   │   │ domain      pure game rules      │
│  lobby.js  │  │  deck-builder│  │  app.js │←─▶│ application use cases + ports    │
└─────┬──────┘  └──────┬───────┘  └────┬────┘   │ infra       http, ws, db, cards  │
      │ REST + WS       │ REST         │ REST+WS └──────────────────────────────────┘
      └─────────────────┴───────┬───────┘
                                ▼
             sqlite (or postgres) for decks/players, in-memory for live games
```

Key property: **the server is the only thing that knows the rules.** Clients send *intents* (`GameAction`), the server validates legality against current state, applies it, and pushes each player a *personalized, information-hidden view* of the new state plus the list of actions that are now legal for them. The client never decides legality; it only renders `legalActions` that arrived from the server.

## 2. Project layout

```text
server/
├── src/
│   ├── index.ts                     entry point -> main()
│   ├── main.ts                      resolves paths, starts server
│   ├── domain/                      pure game logic, zero I/O
│   │   ├── card/Card.ts             Card instance (in-game object)
│   │   ├── card/CardDefinitions.ts  CardDefinition catalog + instance factory
│   │   ├── card/Effect.ts           Effect interface + EffectContext
│   │   ├── game/GameState.ts        GameState, PlayerState, phases
│   │   ├── game/Game.ts             entity wrapper (optional convenience)
│   │   ├── game/errors.ts           GameRuleViolationError
│   │   ├── player/Player.ts         behavior helper around PlayerState
│   │   ├── actions/GameAction.ts    discriminated union of player intents
│   │   ├── rules/RuleSet.ts         the ruleset port (5 methods)
│   │   ├── rules/BasicRuleSet.ts    the concrete game's rules (~1.6k lines)
│   │   └── services/BattleEngine.ts authority loop
│   ├── application/
│   │   ├── ports/GameRepository.ts  save/findById
│   │   ├── ports/GameEvents.ts      gameStarted/actionAccepted/gameFinished
│   │   └── use-cases/               StartGameUseCase, SubmitActionUseCase
│   └── infrastructure/
│       ├── cards/RemoteCardCatalog.ts    CSV (Google Sheets) ingestion
│       ├── http/server.ts                composition root + broadcasts
│       ├── http/http-utils.ts            JSON/SSE/WS writers, id generators
│       ├── http/state-view.ts            per-player sanitized views
│       ├── http/types.ts                 ClientGameView, LobbyState, payloads
│       ├── http/routes/                  static, players, decks, lobby, game
│       ├── http/ws/                      ws-transport, game-ws, lobby-ws
│       ├── persistence/                  PlayerDeckStoreFactory (sqlite|pg)
│       ├── repositories/InMemoryGameRepository.ts
│       └── transport/InMemoryGameEvents.ts
└── public/                          browser client (ES modules, no build step)
    ├── lobby.html/.js               room create/join/chat/deck-select/start
    ├── decks.html + deck-builder.js catalog browsing, deck CRUD
    ├── index.html + app.js          battle page composition root, WS client
    ├── game-view*.js                game render + feature controllers
    ├── battlefield-ui.js, card-ui.js, command-board-ui.js, game-log.js
    └── styles.css
```

Dependency rule: `domain` imports nothing from the outer layers. `application` depends only on `domain` + its own ports. `infrastructure` depends inward. `server.ts` is the **composition root** — the only file that instantiates concrete implementations and wires them.

## 3. Tech stack and conventions

- **TypeScript, strict ESM**: `"type": "module"`, imports end in `.js` (compiled extension), build with `tsc`, dev-run with `tsx watch src/index.ts`.
- **Runtime deps kept minimal**: `ws` (WebSockets), `better-sqlite3` + `drizzle-orm` + `pg` (persistence). Everything else is hand-rolled.
- **No routers/ORM magic**: routes are `if (method === "POST" && pathname === "/api/x")` blocks in per-feature handler functions that return `true` when handled. This is deliberate — the whole protocol stays greppable in one layer.
- **Scripts** (`server/package.json`): `dev`, `build`, `start`, `check` (`tsc --noEmit`). There is no frontend build step; `public/` is served as-is.

## 4. Domain model

### 4.1 Card definition vs card instance

Two distinct concepts — do not merge them:

- **`CardDefinition`** is the immutable catalog entry (what the deckbuilder sees): `{ id, title, type, attack, health, cost, category, rarity?, phase?, description?, copies?, ... }`. Loaded from CSV at startup (or a built-in fallback), served to the client via `GET /api/cards/catalog`.
- **`Card`** is a runtime game object: `{ id, name, type, stats: {attack, health, cost}, effects: Effect[], metadata }`. `createCardFromDefinition(cardDefId, uniqueId)` stamps a definition into an instance and copies presentation/rules fields (`power`, `intellect`, `classColor`, `coloredCosts`, ...) into `metadata`.

Every card in a game gets a **unique instance id** (`${playerId}-${n}-${defId}`) and keeps `metadata.baseCardId` pointing back at the definition. Two copies of the same card are two different `Card` objects; effects that target "a card" always target the instance id.

### 4.2 Game state

```ts
interface PlayerState {
  id: PlayerId; life: number; energy: number;
  deck: Card[]; hand: Card[]; battlefield: Card[]; graveyard: Card[]; exile: Card[];
}
interface GameState {
  gameId: string;
  players: Record<PlayerId, PlayerState>;
  turnPlayerId: PlayerId;
  turnNumber: number;
  phase: GamePhase;            // "setup" | "draw" | "main" | "battle" | "end" | ...
  winnerPlayerId?: PlayerId;
  metadata: Record<string, unknown>;   // ruleset-owned extras (score, ramp, lanes...)
}
```

Zones are plain arrays; ordering matters (deck top = index 0). Anything the generic shape can't express — score piles, opening-ramp counts, combat lane selection, revealed hand cards — lives in `state.metadata` under a namespaced key, and the ruleset ships a `parseXMetadata(value)` function that validates/rehydrates that key into typed data. Treat these parsers as the *only* way ruleset code reads `metadata`: they make the ruleset robust to shape drift and are reused by the presentation layer.

### 4.3 Actions: intents, not RPC

`GameAction` is a discriminated union of everything a player may attempt: `play_card`, `attack`, `end_turn`, `concede`, `move_card`, `draw_one`, `discard_one`, `score`, `attach_card`, phase advances (`phase_produce`, ...), debug-ish helpers (`add_power`, `destroy_unit`, `add_card`), etc. Each variant carries `gameId`, `playerId`, and the ids/amounts it needs. Adding a verb to the game means: add a variant → emit it from `listLegalActions` → handle it in `applyAction` → add a signature case in `BattleEngine.isSameActionSignature`.

### 4.4 RuleSet: the swappable brain

```ts
interface RuleSet {
  readonly id: string; readonly version: string;
  validateDeck(deck: readonly Card[]): DeckValidationResult;
  initializeGame(gameId, playerDecks, playerNames?): GameState;
  listLegalActions(state, playerId): readonly GameAction[];
  applyAction(state, action): GameState;
  getWinner(state): string | undefined;
}
```

Everything game-specific lives behind these five methods. Transport, persistence, and UI work for *any* `RuleSet`. `BasicRuleSet` in this repo implements a full example: 2 players, 20 life, 3 battlefield lanes split into `unit`/`energy` zones (zone is a card's `metadata.zone`), opening hand of 7 + a shared "opening ramp" setup phase, a produce/prepare/combat/study turn loop, score sequence `[1,1,1,2,2,4]` with a win at 6 claimed points, and life<=0 as the alternate loss condition.

### 4.5 BattleEngine: the authority loop

`BattleEngine` wraps a `RuleSet` and enforces the invariants every game shares:

1. `createNewGame` — validate every deck via `ruleSet.validateDeck`, then `initializeGame`.
2. `submitAction` — reject finished games; reject non-active-player actions (except globally-legal ones like `concede`); **legality-check the action by comparing its signature against `ruleSet.listLegalActions`**; apply via `applyAction`; finally run `getWinner` and stamp `winnerPlayerId`.

Signature comparison matters because `listLegalActions` returns fully-formed actions (with concrete card ids, lanes, targets); an incoming action is legal only if it matches one of them field-for-field. This closes the door on forged actions — a client can only replay something the server itself offered.

### 4.6 Mutation discipline: clone, then mutate

`applyAction` must never touch the previous state. The pattern in `BasicRuleSet.cloneState`: deep-clone every player's zone arrays and every `Card` (`Card.clone()`), shallow-clone `metadata`. Then mutate the clone freely and return it. This gives you free undo/audit/replay semantics and makes the state safe to hand to subscribers mid-broadcast.

## 5. Application layer

Tiny by design — two use cases and two ports:

- `StartGameUseCase.execute(gameId, playerDecks, playerNames)` → engine creates state → `repository.save(state)` → `events.gameStarted(state)`.
- `SubmitActionUseCase.execute(action)` → load state → engine validates + applies → save → `events.actionAccepted` → `events.gameFinished` if won.
- `GameRepository` (save / findById) starts as `InMemoryGameRepository` (a `Map`). Swap to Redis/Postgres later without touching anything above it.
- `GameEvents` is implemented as an `EventEmitter` wrapper; the HTTP composition root subscribes `game_started` / `action_accepted` / `game_finished` and re-broadcasts state to connected clients. Events, not direct calls, decouple "a move happened" from "how do sockets find out".

## 6. Hidden information: per-player state views

`sanitizeStateForPlayer(state, playerId, ruleSet)` is the single choke point that converts authoritative state into what one player may see:

- Own zones: full `Card[]` contents.
- Opponent: `deck`/`graveyard`/`exile` replaced by empty arrays + `deckCount`/`graveyardCount`/`exileCount`; `hand` filtered to only cards marked revealed in `metadata.revealedHandByOwner`.
- Battlefield: fully public for everyone.
- Plus: names, score pile, combat lanes, phase/turn, **and `legalActions` computed for *this* viewer** via `ruleSet.listLegalActions`.

Every transport (REST GET, SSE stream, WS push) sends this view — never raw state. The client renders exclusively from it: buttons enable/disable based on `legalActions`, hands render from `hand`, and so on. If you add hidden info to your game, this is the *only* function you need to get right; everything downstream is safe by construction.

## 7. HTTP API surface

| Method & path | Purpose |
|---|---|
| `GET /api/health` | liveness probe |
| `GET /api/cards/catalog` | card definitions + categories for the deckbuilder |
| `POST /api/players` · `GET/PUT /api/players/:id` | player profile upsert/lookup |
| `GET/POST /api/players/:id/decks` · `GET/PUT/DELETE /api/players/:id/decks/:deckId` | deck CRUD (owned by player) |
| `POST /api/lobbies` | create room → `{roomCode, playerId: "p1", playerKey}` |
| `GET /api/lobbies/:code` | lobby snapshot |
| `POST /api/lobbies/:code/join` | take the p2 seat → `{playerId, playerKey}` |
| `POST /api/lobbies/:code/deck-selection` | attach/detach a persisted deck to your seat |
| `POST /api/lobbies/:code/start` | host-only; both seats need decks; creates the game |
| `POST /api/games` | direct game creation (also accepts persisted deck ids) |
| `GET /api/games/:id?playerId=` | current sanitized view |
| `GET /api/games/:id/stream?playerId=` | SSE fallback stream |
| `POST /api/games/:id/actions` | submit a `GameAction` |

Notes that matter:

- **Session keys**: creating/joining a lobby returns an opaque `playerKey`; mutating lobby endpoints (deck-selection, start) require it. It's a lightweight anti-spoof measure, not real auth — swap for real sessions/tokens in production.
- Joining reuses an existing seat with the same name (session recovery), otherwise fills the one open seat; the room holds exactly 2 players and rejects joins after `status === "started"`.
- `POST .../actions` responds `{ok, winnerPlayerId}`; the *resulting state* arrives via the push channels, so clients have one render path.

## 8. WebSocket protocol

A single endpoint, `/ws`, multiplexed by query params:

- `ws://host/ws?gameId=G&playerId=p1` → game channel.
- `ws://host/ws?mode=lobby&roomCode=R&playerId=p1` → lobby channel.

Server → client messages are `{event, payload}` JSON: `ready`, then `game_state` / `lobby_state` on every change. Client → server messages are currently only lobby chat (`{event: "chat_send", payload: {text}}`); game actions go over REST. Upgrades are validated *before* handshake — the game/room/player must exist or the socket is destroyed.

Flow that makes this robust:

1. Use case emits domain event → composition root's `broadcastGameState(gameId)`.
2. For every subscriber of that game: re-load state, `sanitizeStateForPlayer` **per subscriber**, write `game_state`.
3. Clients render whatever arrives; there is no diffing, no client-side simulation.

The browser client (`app.js`) adds the resilience layer: on `onclose` it schedules a reconnect (~900 ms), and a fresh socket immediately receives a full `game_state`, so reconnection is just "wait for next state". SSE (`/stream`) exists as a fallback channel with identical payloads.

Lobby state pushes cover presence, chat (last 100 messages retained in-memory), deck selections, and match start (`gameId` appears in the lobby view → clients navigate to `/game`).

## 9. Deckbuilder and persistence

**Storage shape** — decks are stored compactly, not as card arrays:

```sql
players(id, display_name, created_at)
decks(id, player_id, name, format, created_at, updated_at)
deck_cards(deck_id, card_def_id, quantity)   -- unique (deck_id, card_def_id)
```

A deck is a set of `(cardDefId, quantity 1–3)` rows. Expansion into playable `Card[]` happens at game start (`createDeckFromStoredCards` → `createCardFromDefinition` per copy, unique instance ids). This keeps saves tiny and deck math trivial.

**Port + two adapters**: `PlayerDeckStoreFactory` returns a Postgres adapter when `DATABASE_URL` is set, otherwise a sqlite adapter under `DATA_DIR` (with a tmpdir fallback), wrapped in a common async interface. Deployment (Render) mounts a 1 GB disk at `/var/data` so sqlite persists.

**Validation happens twice, on purpose** — route-level `validateDeckList` (10–30 cards, ≤3 copies per card) guards the API, and ruleset-level `validateDeck` (10–40) guards game creation. When you tune deck rules, change both and keep them consistent.

**Card catalog ingestion**: `RemoteCardCatalog` fetches published Google-Sheets CSVs (one env var per category, e.g. `CARD_CSV_SCIENCE_URL`; `/pubhtml` links are normalized to CSV output). A small hand-rolled parser handles quoted CSV, headers are normalized (`card_id`/`title`/`types`/`power`/`intellect`/`cost`/...), rows become `CardDefinition`s, and the whole catalog is swapped in via `setCardDefinitions`. Any category that fails to load is skipped with a warning and the built-in fallback catalog still guarantees a playable game. Designers edit the spreadsheet; the game updates on restart. The catalog is also exposed to the deckbuilder UI via `GET /api/cards/catalog`.

## 10. Browser client

Three static pages, each with one composition-root module and a bag of feature modules — no framework, no bundler, native ES modules.

- **`lobby.js`** — create/join by room code, live roster + chat over the lobby WS channel, per-seat deck selection, host-only start. Session (`roomCode`, `playerId`, `playerKey`, name) persists in `localStorage` for refresh recovery.
- **`deck-builder.js`** — profile upsert, catalog grid with category filters, quantity-based deck list (1–3 copies, size meter), save/load/delete decks against the player deck API. Session in `localStorage`.
- **`app.js` + `game-view.js`** — the battle screen. `app.js` owns: session/join form, the WebSocket lifecycle (connect/reconnect/parse), `submitAction(partial)` (POSTs to `/api/games/:id/actions`), and a human-readable game log derived from accepted actions. It delegates all rendering to `createGameView({state, el, submitAction, setCommandHint, setConnection, log})`.
- **`game-view.js`** is the render orchestrator; feature controllers (context menu, deck analyze panel, play/discard selection flows, stat-change panel) are created by factory functions that receive their dependencies as arguments — they never import global state. Pure helpers (`card-ui.js`, `battlefield-ui.js`, `command-board-ui.js`, `game-view-render-utils.js`) are side-effect-free DOM builders.

Rendering discipline that keeps the client simple:

- Render is a pure function of the last `game_state` payload; every push re-renders. No optimistic updates — you click, the server applies, the push repaints. There is no client-side submission lock; a double-fire simply gets rejected by the server as an illegal replay, and the error is surfaced in the status line and log.
- The client **never** invents legality: if `legalActions` doesn't contain it, the button doesn't offer it.
- Hidden info is trusted to the view: opponent hand cards render as face-down chips unless the view actually contains the card.

## 11. Deployment

`render.yaml` (single web service): Node 20, `rootDir: server`, build `npm ci --include=dev && npm run build`, start `node dist/index.js`, health check `/api/health`, persistent 1 GB disk at `DATA_DIR=/var/data`, plus the `CARD_CSV_*_URL` env vars. `PORT` is read from the environment. Works the same on any host that gives you a port + a disk.

## 12. Build playbook for a NEW card game

Reuse this exact order — each step is testable before the next:

1. **Freeze the design on one page**: win conditions, resources, zones, turn phases, action verbs. Everything downstream is mechanical.
2. **Scaffold** `server/` (package.json, tsconfig, folder tree from §2) and get `npm run check` green on an empty domain.
3. **Domain first**: `Card`/`CardDefinition`, `GameState` (your zones), `GameAction` (your verbs), `RuleSet`, `GameRuleViolationError`, `BattleEngine` (copy it verbatim — it's game-agnostic).
4. **A stub ruleset**: trivial `validateDeck`/`initializeGame`/`listLegalActions`/`applyAction`/`getWinner`. From this point on, every feature is playable in a unit test without any I/O.
5. **Application layer**: the two use cases + ports (copy verbatim).
6. **Transport**: HTTP server, static routes, `/api/games` + view + actions, SSE, then the WS layer and `sanitizeStateForPlayer`. Two browser tabs can already hotseat a game.
7. **Lobby**: rooms, session keys, start flow (§7–8).
8. **Deckbuilder**: deck tables + store factory, deck routes, catalog + CSV ingestion, `decks.html`.
9. **Game UI**: lobby page, then the battle screen (§10).
10. **Your real ruleset**: replace the stub per `Ruleset-Integration-Guide.md` — one `applyAction` case and one `listLegalActions` block per verb, phase transitions as actions, metadata parsers for extras, `getWinner` covering every win condition.
11. **Harden** (see §13) and deploy (§11).

## 13. Honest gaps to close before "production"

Things this codebase deliberately skips, listed so a successor fixes them early:

- **Determinism/RNG**: shuffling uses `Math.random()`. For replays, audits, or bot testing, inject a seedable RNG into the ruleset and log the seed + accepted actions.
- **Games are in-memory only**: a server restart wipes live matches. Persist `GameState` (or a seed + action log) through `GameRepository` for recovery.
- **No turn timers / auto-concede on disconnect**: a dropped player stalls the match forever. Add per-phase deadlines server-side.
- **No action idempotency or rate limiting**: duplicate submits only fail because the server re-checks legality against the new state; there is no idempotency key or throttling. Add both per player/connection.
- **Session keys are weak auth** and lobby identity is name-based. Real deployments want accounts/tokens.
- **Dual deck validation** (route 10–30 vs ruleset 10–40) can drift — keep one shared constant set.
- **No tests yet.** The layering exists precisely so domain rules can be unit-tested without sockets: aim for valid/invalid/edge triplets per rule and per phase transition (see `Ruleset-Integration-Guide.md` §5).

## 14. Where to look in the code

| Topic | File |
|---|---|
| Authority loop, legality matching | `server/src/domain/services/BattleEngine.ts` |
| Full ruleset example (phases, zones, metadata) | `server/src/domain/rules/BasicRuleSet.ts` |
| Per-player views / hidden info | `server/src/infrastructure/http/state-view.ts` |
| Composition root + event→broadcast wiring | `server/src/infrastructure/http/server.ts` |
| WS multiplexing + lobby chat | `server/src/infrastructure/http/ws/*.ts` |
| Deck storage + sqlite/pg switch | `server/src/infrastructure/persistence/*` |
| CSV catalog ingestion | `server/src/infrastructure/cards/RemoteCardCatalog.ts` |
| WS client + reconnect + action submit | `server/public/app.js` |
| Render-from-state game screen | `server/public/game-view.js` + `game-view-*.js` |
