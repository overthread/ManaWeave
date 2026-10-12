---
name: card-battler-sim
description: Build, scaffold, or extend an online multiplayer deckbuilding card battler (TCG battle simulator) with a server-authoritative Node.js/TypeScript engine, lobby, WebSocket real-time play, deck builder with persistence, and vanilla-JS browser UI. Use whenever the user wants to create a card game simulator, card battler, TCG sim, online deckbuilder, or multiplayer card game — even if they just say "card game", "TCG", or "deckbuilder". Also applies when porting an existing ruleset (e.g. a paper TCG) to an online simulator.
---

# Building an Online Deckbuilder Card Battler

Build a single-process Node.js + TypeScript server that serves the game API, WebSocket transport, deckbuilder API, card catalog, and a framework-free browser client. The architecture below is proven end-to-end (it runs a real 2-player online TCG); follow it unless the user explicitly overrides.

## Prime directives (never violate)

1. **The server owns the rules.** Clients send intents (`GameAction`); the server validates legality against current state, applies, and pushes results. A client never computes game outcomes.
2. **Legality is a server artifact.** The server computes `listLegalActions(state, playerId)` and ships it inside each player's view. The UI enables/renders only what that list contains. This doubles as anti-cheat: an incoming action is accepted only if it matches an offered action field-for-field.
3. **Hidden information is sanitized in one place.** Raw `GameState` never reaches a client. `sanitizeStateForPlayer(state, playerId)` produces per-player views (own zones full, opponent zones become counts, hands filtered by reveal rules).
4. **Clone before mutate.** `applyAction` deep-clones the state, mutates the clone, returns it. The previous state is never touched.
5. **Game-agnostic shell, game-specific ruleset.** Transport, persistence, lobby, deckbuilder, and UI must work for ANY card game. All game rules live behind the 5-method `RuleSet` interface. Swapping games = swapping one class.

## Step 0 — Extract the game design

Before writing code, pin the user's game down (ask; use sensible defaults if they shrug):

- Win/loss conditions (life <= 0? points? decking?)
- Resources (mana/energy? how do they ramp each turn?)
- Zones (deck, hand, battlefield lanes, graveyard, exile, in-play attachments?)
- Turn phases (draw -> main -> combat -> end? custom?)
- Action verbs players may take (play, attack, block, discard, score, move...)
- Deck rules (size, copy limits, sideboard?)
- Player count (assume 2), realtime vs hotseat (this stack does both)

If they have a rules document or spreadsheet of cards, read it now — card data usually lives in a spreadsheet and will be ingested via CSV later.

## Step 1 — Scaffold the project

Layout (single `server/` package serving `public/` static files):

```
server/
  src/
    domain/            card/, game/, actions/, rules/, services/   (pure logic, zero I/O)
    application/       ports/ (GameRepository, GameEvents), use-cases/
    infrastructure/    http/ (server, routes/, ws/), persistence/, repositories/, transport/, cards/
  public/              lobby.html+js, decks.html+js, index.html+js, game-view modules, styles.css
```

`package.json`: `"type": "module"`; deps only `ws`, `better-sqlite3`, `drizzle-orm`, `pg` (+ `@types/*`); dev `tsx`, `typescript`. Scripts: `dev` (tsx watch), `build` (tsc), `start` (node dist), `check` (tsc --noEmit). No HTTP framework, no frontend bundler.

For module responsibilities, interface shapes, and copy-ready skeletons, read `references/architecture-blueprint.md`.

## Step 2 — Domain layer (pure, testable, no I/O)

Create in this order; typecheck after each:

1. `Card` (instance: id, name, type, stats, effects, metadata) + `CardDefinition` (catalog entry) + `createCardFromDefinition` factory + a small built-in fallback catalog.
2. `GameState` / `PlayerState` — zones as arrays (deck top = index 0), `turnPlayerId`, `turnNumber`, `phase`, `winnerPlayerId?`, `metadata` for ruleset extras.
3. `GameAction` — one discriminated-union variant per verb from Step 0.
4. `RuleSet` interface — `id`, `version`, `validateDeck`, `initializeGame`, `listLegalActions`, `applyAction`, `getWinner`.
5. `GameRuleViolationError` + `BattleEngine` (copy the authority loop verbatim from the blueprint — it is game-agnostic).
6. A **stub ruleset** with trivial implementations. From here on the game is playable headlessly.

Patterns that must be followed: unique per-game card instance ids (`${playerId}-${n}-${defId}`) with `metadata.baseCardId` back-reference; ruleset-owned state extras live in `state.metadata` behind `parseXMetadata()` rehydration functions; `applyAction` = `cloneState()` then switch on `action.type` then return.

## Step 3 — Application layer

`StartGameUseCase` (validate decks -> init -> save -> emit) and `SubmitActionUseCase` (load -> engine.submitAction -> save -> emit; emit `gameFinished` on winner). Ports `GameRepository` (save/findById) and `GameEvents` (started/accepted/finished) — start with in-memory Map + EventEmitter implementations. Copy verbatim from the blueprint.

## Step 4 — Transport: HTTP + WebSocket

- Raw `node:http`. Routes are per-feature handler functions (`handleGameRoutes`, `handleLobbyRoutes`, ...) returning `boolean`, chained in `routes/index.ts`, receiving dependencies through a `RouteContext` object. `server.ts` is the composition root — the only file that news up concrete classes.
- Endpoints: health, card catalog, players, player decks (CRUD), lobbies (create/join/deck-selection/start), games (create/view/actions + SSE stream fallback). Exact table, payload shapes, and WS message protocol: `references/protocol-and-data.md`.
- WebSocket: ONE `/ws` endpoint multiplexed by query params (`gameId`+`playerId` for games, `mode=lobby`+`roomCode` for lobbies). Server pushes `{event, payload}` JSON — `ready`, then `game_state` / `lobby_state` after every accepted action. Validate room/game/player existence BEFORE handshake upgrade.
- Event flow: use case emits domain event -> composition root subscribes -> `broadcastGameState(gameId)` reloads state and sends `sanitizeStateForPlayer(state, subscriberPlayerId)` to each subscriber individually (each player gets their own view).
- Game actions go over `POST /api/games/:id/actions`; the resulting state arrives via push. Clients render only from pushed views (no optimistic updates).

## Step 5 — Lobby

In-memory `Map<roomCode, LobbyState>`: 6-char room code from an unambiguous alphabet, seats `p1`/`p2`, per-seat deck selection referencing persisted decks, in-room chat over WS (cap history ~100), host-only start requiring BOTH seats to have decks. Issue an opaque `playerKey` on create/join and require it on mutating endpoints (lightweight anti-spoof; real auth is a production upgrade). Start = create game via use case, set `status: "started"`, broadcast so clients navigate to the battle page.

## Step 6 — Deckbuilder + persistence + card catalog

- Tables: `players`, `decks(id, player_id, name, format)`, `deck_cards(deck_id, card_def_id, quantity)` — decks stored as definition ids + quantities, expanded into `Card` instances only at game start.
- `PlayerDeckStoreFactory`: if `DATABASE_URL` -> Postgres adapter, else sqlite under `DATA_DIR` (tmpdir fallback). One async port interface, two adapters.
- Deck validation exists at BOTH the route (API guard) and the ruleset (game-creation guard). Keep the constants in one shared module so they can't drift.
- Card catalog: fetch published Google-Sheets CSVs (one env var per category, normalize `/pubhtml` -> CSV output), parse with a small quoted-CSV parser, map rows -> `CardDefinition`s, `setCardDefinitions()` at startup; failed categories fall back to the built-in catalog with a warning. Serve the catalog to the deckbuilder UI at `GET /api/cards/catalog`. This lets designers balance cards in a spreadsheet with zero code deploys.

## Step 7 — Browser client

Three static pages, native ES modules, one composition-root module each:

- `lobby.js` — create/join room, live roster + chat (lobby WS), deck selection, start; session in `localStorage` for refresh recovery.
- `deck-builder.js` — profile, catalog grid with category filters, quantity-based list (enforce copy limit + deck size client-side as UX only; server re-validates), deck CRUD.
- `app.js` + `game-view.js` — battle screen. `app.js`: WS lifecycle with ~1s auto-reconnect (fresh socket -> full `game_state` push = instant recovery), `submitAction(partial)` POST helper, human-readable game log. `game-view.js`: orchestrates rendering from the pushed view via feature-controller factories (context menu, selection flows, panels) that receive dependencies as arguments; side-effect-free render helpers (`card-ui.js`, `battlefield-ui.js`) build DOM.

UI rules: render = pure function of last pushed view; buttons driven by `legalActions`; opponent hidden zones render as counts/face-down unless the view actually contains cards; guard in-flight action clicks.

## Step 8 — The real ruleset (the actual game work)

Replace the stub following `references/ruleset-and-hardening.md`: one `listLegalActions` block + one `applyAction` case per verb, phase transitions as explicit actions, `parseXMetadata` helpers for every `metadata` key, `getWinner` covering ALL win conditions, end-of-turn cleanup as an explicit action case. Test each rule valid/invalid/edge at the domain layer before wiring UI polish.

## Step 9 — Verify + ship

- `npm run check` green; dev server up; health endpoint OK.
- Two-browser test: create room in tab A, join in tab B, pick decks, start, play cards / attack / end turn from both tabs, confirm hidden info (opponent hand face-down), refresh tab A and confirm state recovery via WS.
- Deckbuilder round-trip: save deck -> appears in lobby selection -> game starts with its cards.
- Production hardening backlog (do not skip if this will see real players): seedable RNG + action log for replay/determinism, persist games (or seed+actions) instead of memory-only, turn timers + disconnect handling, action idempotency + rate limits, real auth. Full checklist: `references/ruleset-and-hardening.md`.
- Deploy: any host with a port + persistent disk (Render web service works: build `tsc`, start `node dist/index.js`, health `/api/health`, disk at `DATA_DIR`, `CARD_CSV_*_URL` env vars).
