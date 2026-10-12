# ManaWeave — Game Design & Rules Reference

An online 2-player card battler. **You are a weaver. Four threads hang in your loom — flip them to pay, rotate them to weave, and pull your pattern down over your opponent's pattern until theirs unravels.**

This document is the authoritative rules reference for the current ruleset (`manaweave` v3.1.0, implemented in `server/src/domain/rules/LoomRuleSet.ts`).

---

## 1. The Loom

Each player has a **Loom of 4 threads**. A thread has:

- a **colour** — Ember 🔥, Tide 🌊, Verdant 🌿, or Umbra 🌙 (never neutral),
- an **orientation** — one of the four directions it points: **up ↑, right →, down ↓, left ←**,
- a **readiness** — ready or **exhausted** (flipped).

All threads start the game pointing **up**. Threads are the game's only resource: everything is paid for by exhausting (flipping) threads, and the weave step rotates them.

## 2. Costs are coloured orientations

A card's cost is a **list of coloured arrows**. Each arrow is paid by exhausting one ready thread that **matches both the arrow's colour and its direction exactly**:

> **Flamecaller Djinn — cost: `ember:up + ember:right + any:up`** (🔥↑ 🔥→ ⬆)
> Play it by flipping an ember thread pointing up, an ember thread pointing right, and any third thread pointing up.

Rules for payment:

- **One thread per arrow.** A cost of N arrows always exhausts exactly N distinct ready threads.
- **Colour and direction must both match.** A right-pointing Tide thread cannot pay an `ember:right` arrow.
- **Grey `any` arrows** take a thread of *any* colour. They appear on neutral cards and on heavy costs that need extra threads beyond one colour's supply (each loom colour is typically only 2 threads).
- **The whole cost is an exact match** — you cannot overpay or substitute. If no assignment of your ready threads covers every arrow, the card cannot be cast right now.
- All your exhausted threads **flip back to ready** at the start of each of your rounds, so you can re-pay every round.

### Design intent

- Because threads start **up**, plain up-arrows are "round 1" costs. Arrows pointing right/down/left must be **woven ahead** (see §3) before the card unlocks — rotating a thread is an investment in a future play.
- Because a colour's arrows demand that colour's threads, **loom composition is a hard deck-building constraint** (see §7): a card with two ember arrows requires a loom holding at least two ember threads, or it can never be cast.
- Rotating has tension: turning a thread away from up unlocks new costs but can strand cards that still need up-arrows.

## 3. The round

Players alternate rounds. Your round, in order:

1. **Round start** — all your threads ready; draw a card. If your deck is empty your pattern frays: you lose 1 life per missed draw.
2. **Main step** — act in any order, any number of times:
   - **play** cards from hand (exhaust threads to pay),
   - **move** a back-row unit forward (same lane, front slot free, once per round per unit),
   - **attack** with front-row units (a declaration: the unit exhausts — see §4).
3. **Weave step (optional)** — rotate **one** of your threads 90° clockwise or counter-clockwise. Once per round.
4. **End round** — pass to the opponent.

Units cannot attack the round they are played unless they have **Quickstride**.

## 4. The board

3 lanes × 2 rows (front/back) per player = 12 slots on your side. Units enter any free slot; one unit per slot.

**Combat** — only front-row units attack, into their own lane. Clicking the ⚔ badge on an eligible unit **starts the combat: the unit exhausts, and that is everything the engine does.** The damage itself is applied by hand via manual actions (§6.1), following defender priority:

1. Enemy **front** unit in the lane → the two units deal their power to each other simultaneously.
2. Only an enemy **back** unit in the lane → your unit hits it with no retaliation.
3. Empty lane → your unit hits the enemy weaver directly.

## 5. Zones & winning

Zones: loom, hand, battlefield, deck, **discard** (graveyard), **purge** (exile).

The **discard and purge piles are public** — both weavers see their contents (each player's bar shows live deck / discard / purge piles; clicking discard or purge opens the pile's cards, and any card in them can be right-clicked to send it elsewhere). Decks and hands stay hidden: the deck renders as a count, and only its owner may peek at it.

**Win** by reducing the enemy weaver to 0 life (both start at 20), or by concession. Each player draws one card per round — empty decks bleed life, eventually lethally.

## 6. Keywords & effects

- **Quickstride** — the unit can attack the round it is woven.
- Effect vocabulary (spells and "when woven" triggers): damage a unit, damage the enemy weaver, heal your weaver, buff/debuff a unit, draw cards, **ready** an exhausted thread, **rotate** a thread 90° in a chosen direction, return a unit to its owner's hand, destroy a low-power enemy unit, make the enemy purge deck cards.

### 6.1 Manual resolution

The engine never resolves card effects or combat damage. Playing a spell pays its cost and puts it in the discard; weaving a trigger unit pays its cost and deploys it; attacking exhausts the attacker. The players apply the outcome themselves through **manual actions**, fired from **right-click context menus** on the board (no panel):

- **Right-click a unit** (either side): deal damage, adjust power / health (steppers, signed), return to owner's hand, destroy, or send it to another area.
- **Right-click a hand card**: discard it, or send it to the deck (top/bottom) or purge.
- **Right-click a thread** (either loom): rotate 90° clockwise or counter-clockwise, ready or exhaust it. During your own weave step the legal weave is offered in the same menu.
- **Right-click a deck pile** (either side): draw N, purge top N, shuffle — and for your own deck, *look at top N* (a private peek panel; only you ever see those cards, and it refreshes automatically as the deck changes).
- **Discard / purge piles**: click to view their cards; right-click a card inside to send it to hand, deck top/bottom, or the other pile.
- **Weaver life**: each player bar has **− / +** buttons (±1 life per click).

Every change to life, unit power and unit health is shown as a **floating delta indicator** (`+2` / `−2`) next to the affected number instead of a silent value swap.

- **Unrestricted by design**: either weaver may fire manual actions at any time, even outside their turn — no turn gating, no legality enumeration. Cross-player moves are legal (you may rotate an enemy thread or send an enemy unit to hand); the only hidden-information rule is that `peek_deck` targets your own deck.
- The server validates that targets exist and amounts are whole numbers (clamped to ±999); every resulting state change (life, unit health, zones, threads, decks) is tracked server-side, and a weaver hitting 0 life still ends the game.
- The manual verbs cover the full effect vocabulary plus combat damage and playtest tools: `damage_unit`, `damage_face`, `heal_face`, `buff_unit`, `draw`, `ready_thread`, `exhaust_thread`, `rotate_thread`, `return_to_hand`, `destroy_unit`, `purge_deck_top`, `peek_deck`, `shuffle_deck`, `move_card` (send any card in any zone to hand / deck top / deck bottom / discard / purge).

## 7. Deck construction

- **20–30 cards**, max **3 copies** of any one card.
- You also choose your **loom composition**: exactly 4 thread colours.
- **Constraint:** for every card in the deck, your loom must hold **at least as many threads of each cost colour as the card's most demanding single cost** — e.g. a deck running Nightprowler (`umbra:up + umbra:up`) needs ≥ 2 umbra threads. `any` arrows demand nothing. Enforced server-side at game creation and client-side in the deck builder.
- Typical looms are 2+2 (e.g. Ember/Ember/Umbra/Umbra). Mono-colour looms (4× one colour) maximise that colour's heavy cards but lose `any`-arrow flexibility... and every other colour.

## 8. Built-in card catalog (37 cards)

Costs below are written as `Colour ↑` arrows; a bare `↑` is an `any` arrow. The catalog lives in `server/src/domain/card/CardDefinitions.ts` and can be replaced from CSV (§9).

### Ember 🔥

| Card | Atk/Hp | Cost | Notes |
|---|---|---|---|
| Cinder Whelp | 2/1 | Ember ↑ | Quickstride. |
| Ember Skirmisher | 3/2 | Ember ↑ + Ember ↑ | |
| Warpath Howler | 2/2 | Ember ↑ + Ember ↑ | Quickstride. |
| Ashblade Berserker | 4/3 | Ember ↑ + Ember ↑ + ↑ | |
| Flamecaller Djinn | 5/3 | Ember ↑ + Ember → + ↑ | Weave an ember thread right to unlock. |
| Pyre Colossus | 6/6 | Ember ↑ + Ember ↓ + ↑ + ↑ | The whole loom, one ember woven down. |
| Scorch | spell | Ember ↑ | Deal 2 damage to any unit. |
| Immolate | spell | Ember ↑ + Ember ↑ | Deal 3 damage to any unit. |
| Blazing Rush | spell | Ember ↑ | A friendly unit gains +2 power. |
| Ember Volley | spell | Ember ↑ + Ember ↑ + ↑ | Deal 4 damage to the enemy weaver. |

### Tide 🌊

| Card | Atk/Hp | Cost | Notes |
|---|---|---|---|
| Tidepool Scout | 1/2 | Tide ↑ | |
| Mistward Sentinel | 2/4 | Tide ↑ + Tide ↑ | |
| Riptide Adept | 2/2 | Tide ↑ + Tide ↑ | When woven: draw a card. |
| Deepwater Leviathan | 5/6 | Tide ↑ + Tide ↓ + ↑ + ↑ | The whole loom, one tide woven down. |
| Undertow | spell | Tide ↑ + Tide ↑ | Return an enemy unit to its owner's hand. |
| Tidal Insight | spell | Tide ↑ + Tide ↑ | Draw 2 cards. |
| Still Waters | spell | Tide ↑ | Ready (un-exhaust) one of your exhausted threads. |
| Moonlit Current | spell | Tide ↑ + Tide ← | Rotate one of your threads 90°, then draw a card. |

### Verdant 🌿

| Card | Atk/Hp | Cost | Notes |
|---|---|---|---|
| Sapling Warden | 1/3 | Verdant ↑ | |
| Grovekeeper | 2/3 | Verdant ↑ + Verdant ↑ | When woven: gain 3 life. |
| Thornhide Behemoth | 4/5 | Verdant ↑ + Verdant ↑ + ↑ | |
| Ancient Treant | 6/7 | Verdant ↑ + Verdant ↓ + ↑ + ↑ | The whole loom, one verdant woven down. |
| Wildbloom | spell | Verdant ↑ | Gain 4 life. |
| Nature's Bounty | spell | Verdant ↑ + Verdant ↑ | Draw a card and gain 2 life. |
| Deep Roots | spell | Verdant ↑ + Verdant ↓ | A friendly unit gains +2/+2. |

### Umbra 🌙

| Card | Atk/Hp | Cost | Notes |
|---|---|---|---|
| Shadewisp | 2/1 | Umbra ↑ | |
| Nightprowler | 2/2 | Umbra ↑ + Umbra ↑ | Quickstride. |
| Duskfang Stalker | 4/2 | Umbra ↑ + Umbra ↑ + ↑ | |
| Voidcaller | 3/4 | Umbra ↑ + Umbra ← + ↑ | Weave an umbra thread left to unlock. |
| Night Reaper | 5/5 | Umbra ↑ + Umbra ↓ + ↑ + ↑ | The whole loom, one umbra woven down. |
| Silencer's Blade | spell | Umbra ↑ + Umbra ↑ | Destroy an enemy unit with ≤ 3 power. |
| Soul Fracture | spell | Umbra ↑ + Umbra ↑ | Enemy purges the top 2 cards of their deck. |
| Wraith's Grasp | spell | Umbra ↑ | An enemy unit gets −0/−2. |

### Neutral ◇

| Card | Atk/Hp | Cost | Notes |
|---|---|---|---|
| Wandering Apprentice | 1/1 | ↑ | |
| Roadwarden | 2/2 | ↑ + ↑ | |
| Mercenary Captain | 3/3 | ↑ + ↑ + ↑ | |
| Flash of Steel | spell | ↑ | A friendly unit gains +1 power. |

## 9. CSV catalog format

Card data can come from published Google Sheets CSVs (`CARD_CSV_UNITS_URL`, `CARD_CSV_SPELLS_URL` env vars; `/pubhtml` links are auto-normalized). One sheet per category (units/spells). Header names are normalized (lowercase, spaces/dashes → underscores). Failed sheets fall back to the built-in catalog.

| Column | Aliases | Format |
|---|---|---|
| `title` | `name` | required — row skipped without it |
| `card_id` | `id` | optional, defaults to slugified title |
| `type` | | `unit` or `spell` (anything but "spell" = unit) |
| `colour` | `color` | `ember` / `tide` / `verdant` / `umbra` / `neutral` |
| `cost` | | `colour:orientation` entries separated by `+`, `,` or spaces — e.g. `ember:up + ember:left`, shorthand `e:u e:l`, wildcard `any:down` |
| `orientation_req` | `orientation` | legacy column — forces the last entry's orientation |
| `attack` | `power` | number |
| `health` | | number |
| `haste` | `quickstride` | `true` / `yes` / `1` |
| `effects` | | JSON array (see §6 vocabulary), e.g. `[{"kind":"damage_unit","amount":2,"scope":"any"}]` |
| `on_play` | | JSON array for "when woven" triggers |
| `text` | `description` | rules text shown on the card |
| `rarity` | | defaults to `common` |

**Legacy compatibility:** a bare orientation token (`up left`) uses the row's own colour (or `any` for neutral rows); a bare number `N` becomes N × `<row colour>:up`; the old `orientation_req` column re-points the final entry.

### Cost notation cheat-sheet

| Written | Meaning |
|---|---|
| `ember:up` / `e:u` | one ember thread pointing up |
| `any:down` / `down` | one thread of any colour pointing down |
| `2` | two of the row colour's threads pointing up (legacy) |
| `ember:up + tide:left` | one ember up **and** one tide left (multi-colour "gold" costs are legal) |

## 10. Where things live

- **Rules** — `server/src/domain/rules/LoomRuleSet.ts` (payment, combat-as-declaration, manual effect application, turns, deck & loom validation)
- **Manual actions** — `ManualAction` in `server/src/domain/actions/GameAction.ts`; exempt from turn/legality gating in `BattleEngine`, applied by `applyManualAction` (incl. `move_card`, `peek_deck`, `shuffle_deck`, `exhaust_thread`)
- **Deck peeks** — `DeckPeekMetadata`/`parseDeckPeeks` in `LoomRuleSet.ts`; stored as card ids in `state.metadata.deckPeek`, re-snapshotted after every action, shipped **only** to the peeking player's view in `sanitize.ts`
- **Cards** — `server/src/domain/card/CardDefinitions.ts` (built-in catalog + cost parser), `Card.ts` (`CostEntry` + `CardEffect` types)
- **CSV ingestion** — `server/src/infrastructure/cards/csvCatalog.ts`
- **Accounts & login** — `server/src/infrastructure/persistence/JsonAccountStore.ts` (`DATA_DIR/accounts.json`, unsalted sha256 — playtest-grade, not production auth), `server/src/infrastructure/auth/tokens.ts` (stateless HMAC bearer tokens), routes in `http/routes/authRoutes.ts`; deck CRUD is account-scoped at `/api/decks`, lobby seats bind to accounts in `lobby/LobbyState.ts` (`playerAccounts`)
- **Client sessions** — `server/public/js/shared.js`: sessions in `sessionStorage` (per browser tab) so one browser can hold both seats for local playtesting; `login.html` + `js/login.js` handle register/login (`?switch=1` forces a fresh login for the second-seat link)
- **Client views** — `server/src/domain/game/sanitize.ts` (cost pairs as `{colour, orientation}` JSON; discard/purge piles public, deck peeks owner-only)
- **Context menus** — `server/public/js/context-menu.js` (right-click menus: actions, submenus, −/+ steppers); wired into every card/thread/pile by `game-view.js`, which also renders the zone piles, life −/+ buttons, peek panel, pile viewers and the floating `+N/−N` delta indicators
- **Tests** — `server/src/test/domain-test.ts` (`npm run test:domain`, 84 checks incl. manual actions, zone moves & deck peeks)
- **Architecture & running** — see the root `README.md`
