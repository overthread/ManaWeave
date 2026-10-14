# ManaWeave

An online 2-player card battler built on the card-battler starter kit architecture (server-authoritative Node.js/TypeScript engine, WebSocket real-time play, deck builder with persistence, vanilla-JS browser UI).

**You are a weaver. Four threads hang in your loom — flip them to pay, rotate them to weave, and pull your pattern down over your opponent's.**

> Full rules, card catalog and CSV format: **[docs/game-design.md](docs/game-design.md)** · balancing price list (amber): **[docs/amber.md](docs/amber.md)**

## The rules

- Each player starts at **20 life** with a **Loom of 4 threads** (colours: Crimson, Azure, Verdant), all pointing **up**. Threads are the mana source for everything.
- **Costs are coloured orientations.** A card's cost is a list of coloured arrows — e.g. 🌋↑ 🌋← — paid by exhausting (flipping) one ready thread per arrow, **matching both its colour and its direction exactly**. Grey `any` arrows take a thread of any colour. All your threads flip back at the start of each of your rounds.
- **Loom composition matters**: a card needing two crimson arrows can never be paid with fewer than two crimson threads, so decks demand enough threads of each cost colour (the deck builder enforces it).
- **Weave**: at the end of your round you may rotate **one** thread 90° clockwise or counter-clockwise. Threads start pointing **up**, so anything beyond plain up-arrows must be *woven ahead* — e.g. *Astral Weaver* costs ☁️↑ ☁️→: rotate an azure thread right during an early weave to unlock it. Rotating also re-points threads that drifted somewhere useless.
- **Your round** (full autonomy in the main step — act in any order):
  1. Draw a card (empty deck frays your pattern: 1 life per missed draw).
  2. Main step: **move** units from back row to front row, **play** cards, and **attack** with units — in any order.
  3. Optional **weave step**: rotate one thread.
  4. End round.
- **The board**: 3 lanes × 2 rows per player (front/back) = 12 slots. Deploy units to any free slot on your side; one unit per slot.
- **Combat** (front row only; units can't attack the round they arrive unless they have *Quickstride*): click the **⚔ badge** on a unit to start the combat — **the unit exhausts and that's it**. The damage itself (to the enemy front unit, back unit, or weaver, per defender priority) is applied by hand from the unit's right-click menu.
- **Card effects are manual.** The engine never resolves spells, "when woven" triggers, or combat damage — casting a spell pays its cost and parks it on the **shared spell stack** (the strip under the battlefield). **Reactions** (keyword on the card) may be cast outside your own round and land **on top of the same stack**; the newest spell resolves first, and resolving/countering a stack spell is itself manual. Players apply every effect through **right-click context menus** — unrestricted: **either weaver, any time**, even outside their turn. The server validates targets/amounts and tracks all state changes. Every life / power / health change shows as a floating **+N / −N** indicator.
  - **Right-click a stack spell**: resolve it (effect by hand → caster's discard), counter it (fizzles unresolved), or send it elsewhere; the strip also has a **✔ Resolve top** button.
  - **Right-click a unit**: deal damage, adjust power & health, return to hand, destroy, or send to another area.
  - **Right-click a hand card**: discard it, or send it to the deck top/bottom or purge.
  - **Right-click a thread** (either loom): rotate 90° cw/ccw, ready or exhaust it, **excite** it (add an excite token — ✦ badge) or **unleash** (spend one). A Threadling can also be **sacrificed** — removed from the loom outright.
  - **Right-click a deck** (either side): draw N, purge top N, shuffle — your own deck can also *look at top N* (private peek panel that auto-refreshes).
  - **Discard / purge piles** sit on each player's bar next to the deck; click one to view its cards, right-click a card inside to send it anywhere (hand, deck top/bottom, the other pile).
  - **Weaver life**: **− / +** buttons on each player bar (±1 per click).
- **Zones**: loom, hand, battlefield, deck, **discard** (graveyard), **purge** (exile), and the **spell stack** — one shared spell slot where every cast waits (both weavers' spells, newest on top, top resolves first) until resolved or countered by hand. Discard and purge are public — both weavers see the piles' contents; so is the stack.
- **Win**: reduce the enemy weaver to 0 life (or make them concede).
- **Decks**: 20–30 cards, max 2 copies each, plus your loom composition (exactly 4 thread colours — every coloured card in the deck needs a matching thread).

## Run it

```bash
cd server
npm install
npm run dev          # http://localhost:3000
```

The app has **accounts** (playtest-grade login — username + password, no email/reset): decks are saved to your account, so they follow you across browsers and refreshes on the same server.

1. **Register** (`/login.html` — the lobby redirects here when a tab has no session).
2. **Build a deck** (`/decks.html`): pick your 4 loom thread colours, add cards (or load a sample), save. Loading a saved deck and saving again updates it in place.
3. **Lobby** (`/lobby.html`): create a room, share the code; both weavers pick decks; the host starts.
4. **Battle**: click a hand card → its threads auto-pay (click your threads to change payment — each must match an arrow's colour and direction) → click a free slot for units, or Cast for spells. Cast spells wait on the **shared spell stack**; while the opponent weaves you may cast **Reaction** spells from your hand (highlighted, with a "reaction window" pill) — they pay threads and land on top of the same stack. Resolve the stack top-first: right-click a stack spell to **Resolve** (apply its effect by hand, then it discards) or **Counter**, or hit **✔ Resolve top**. Attack by clicking the **⚔ badge** on a front unit (it exhausts; clicking the card body never attacks); click back units to move up. Resolve combat damage and card effects by **right-clicking** whatever you're resolving — units (damage / power / health steppers), threads (rotate / ready / exhaust / excite / unleash), your deck (draw / peek / shuffle / purge), hand cards (discard), or the discard & purge piles (send cards between areas). Adjust either weaver's life with the **− / +** buttons on the player bars.

**Moving between lobby and deck builder:** the Deck Builder link opens in the same tab, so the trip never asks you to log in again — and when you come back, the lobby re-opens your room automatically (from the tab's own memory on refresh, or from a per-account reminder in `localStorage` in a fresh tab or after a re-login — the server re-seats you by account). No room code re-typing either way.

**After a match ends** (life loss or concession), the room returns to *waiting* with both seats and deck picks kept: **Back to Lobby** drops you into a rematch-ready room, and the host can start the next game right away — a player still on the lobby page auto-joins the new match. While a match is *live*, room recovery still sends you back into it (refresh recovery).

### Playtesting against yourself (same computer, same browser)

Sessions are **per browser tab**, so one browser can host two weavers:

1. In tab 1, log in as your main account and **Create Room**.
2. Click **“→ open second seat”** in the room panel — it opens a second tab at the login page with the room code pre-wired.
3. In that tab, register (or log in as) a second weaver; it auto-joins the room as the challenger seat.
4. Both tabs pick decks; start from tab 1 — each tab opens the battle at its own seat and stays in sync over WebSocket. No second browser profile or private window needed.

(The second seat needs a *different* account — joining with the host's account reclaims the host seat, which is also how refresh recovery works.)

Quick test without decks: `curl -X POST http://localhost:3000/api/games -H "Content-Type: application/json" -d "{}"` → open `/?gameId=<id>&playerId=p1` and `&playerId=p2`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with watch (tsx) |
| `npm run build` / `npm start` | Compile and run production build |
| `npm run check` | TypeScript typecheck |
| `npm run test:domain` | 138 headless ruleset tests (threads, orientation costs, combat-as-declaration, the shared spell stack & Reaction casting, manual actions & zone moves, deck peeks, excite/unleash, Threadling sacrifice, weave, win conditions, sanitization, CSV catalog mapping) |

## Architecture (from the starter kit)

- **Server owns the rules.** Clients send intents; the server validates against `listLegalActions` (legality as data — also the anti-cheat seam) and pushes sanitized per-player views over WebSocket. Hidden information (opponent hand/deck) is stripped in exactly one place (`sanitizeStateForPlayer`). One deliberate exception: **manual effect actions** — they carry no turn/legality gating by design (either player, any time); the ruleset still validates their targets and applies every state change.
- **Game-agnostic shell, game-specific ruleset.** Everything game-specific lives in `server/src/domain/rules/LoomRuleSet.ts` behind the 5-method `RuleSet` interface; swap games by swapping one class.
- **Layers**: `domain/` (pure rules, zero I/O) → `application/` (use cases + ports) → `infrastructure/` (HTTP routes, WebSocket transport, JSON persistence, CSV catalog loader) → `public/` (framework-free ES-module client).
- **36-card built-in catalog** (`domain/card/CardDefinitions.ts`) — a faithful transcription of the three published colour sheets (12 Crimson *Riff*, 12 Verdant *Sporic*, 12 Azure *Astral*), costed against the **amber** balancing economy (arrow budgets ↑1 ←4 →4 ↓8; stat & effect prices — see `docs/amber.md`). Card data can also come from published Google Sheets CSVs (`CARD_CSV_URL` env var; a comma-separated list of sheet URLs, e.g. one per colour tab) — balance in a spreadsheet with zero deploys. The draft sheets' `effect` prose column is shown as card text, and their Crimson/Azure colours are first-class, loom-pickable thread colours.
- **Accounts & login** (playtest-grade by design): JSON mode stores them in `DATA_DIR/accounts.json` (unsalted sha256 passwords — explicitly *not* production auth), stateless HMAC bearer tokens (`auth/tokens.ts`, secret persisted as `DATA_DIR/auth-secret`, override with `AUTH_SECRET`). Deck CRUD lives at `/api/decks` scoped to the logged-in account; lobby seats are bound to account ids (`playerAccounts`), so join/refresh recovery matches on *who you are*, never on display names. The browser keeps sessions in `sessionStorage` — per tab — which is what lets one browser sit in both seats for local playtesting. The deck builder opens in the same tab (so the session and room survive the round trip), and the lobby additionally remembers each account's current room in `localStorage` (`manaweave.room.<accountId>`) — returning to the lobby, even in a fresh tab after a re-login, re-enters your room without asking for the code.
- **Decks persist** in `server/data/decks.json` locally — and in **Postgres when `DATABASE_URL` is set** (see below). Both live behind the same `AccountStore` / `AsyncPlayerDeckStore` ports (`infrastructure/persistence/`), so switching stores touches nothing else. Games themselves are in-memory (restart ends live matches — fine for a v1; see hardening notes below).

### Keeping data across restarts on Render (free tier)

Render's free plan has an **ephemeral filesystem** — every redeploy and spin-down (it sleeps after 15 min idle) wipes `server/data/`, so accounts, decks and login sessions vanished on each cold start. Fix: point `DATABASE_URL` at a managed Postgres; a **free Neon database** (neon.tech) is enough:

1. Create a project at neon.tech → copy the connection string (`postgresql://user:pass@host/dbname?sslmode=require`).
2. Render dashboard → ManaWeave → Environment → set `DATABASE_URL` to that string.
3. Redeploy once. On boot the server creates the tables (`accounts`, `players`, `decks`, `deck_cards`, `app_secrets`) automatically, stores the auth-token secret in Postgres too (so existing logins survive), and logs `[persistence] Postgres (DATABASE_URL)`.

Local dev without `DATABASE_URL` keeps using the JSON files, exactly as before.

### Production hardening backlog (before real players)

Seed + action-log replay persistence, turn timers, disconnect grace, action idempotency/rate limits, salted password hashing + HTTPS + rate-limited login (current auth is deliberately simple: unsalted sha256, bearer tokens with no expiry).

## Layout

```
server/
  src/
    domain/            card/, game/, actions/, rules/, services/   (pure logic)
    application/       ports/, use-cases/
    infrastructure/    http/ (server + routes/), auth/tokens.ts, transport/ws.ts,
                       persistence/ (JsonDeckStore, JsonAccountStore, PostgresStores), lobby/, cards/
    test/              domain-test.ts
  public/              login.html, lobby.html, decks.html, index.html + js/ modules + styles.css
```
