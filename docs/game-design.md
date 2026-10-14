# ManaWeave — Game Design & Rules Reference

An online 2-player card battler. **You are a weaver. Four threads hang in your loom — flip them to pay, rotate them to weave, and pull your pattern down over your opponent's pattern until theirs unravels.**

This document is the authoritative rules reference for the current ruleset (`manaweave` v3.4.0, implemented in `server/src/domain/rules/LoomRuleSet.ts`).

---

## 1. The Loom

Each player has a **Loom of 4 threads** — Sprout effects can grow it past four with Threadling tokens (§6). A thread has:

- a **colour** — Crimson 🌋, Azure ☁️, or Verdant 🌿 (never neutral),
- an **orientation** — one of the four directions it points: **up ↑, right →, down ↓, left ←**,
- a **readiness** — ready or **exhausted** (flipped).

All threads start the game pointing **up**. Threads are the game's only resource: everything is paid for by exhausting (flipping) threads, and the weave step rotates them.

## 2. Costs are coloured orientations

A card's cost is a **list of coloured arrows**. Each arrow is paid by exhausting one ready thread that **matches both the arrow's colour and its direction exactly**:

> **Astral Weaver — cost: `azure:up + azure:right`** (☁️↑ ☁️→)
> Play it by flipping an azure thread pointing up and an azure thread pointing right.

Rules for payment:

- **One thread per arrow.** A cost of N arrows always exhausts exactly N distinct ready threads.
- **Colour and direction must both match.** A right-pointing Verdant thread cannot pay a `crimson:right` arrow.
- **Grey `any` arrows** take a thread of *any* colour. They appear on neutral cards and on heavy costs that need extra threads beyond one colour's supply (each loom colour is typically only 2 threads).
- **The whole cost is an exact match** — you cannot overpay or substitute. If no assignment of your ready threads covers every arrow, the card cannot be cast right now.
- All your exhausted threads **flip back to ready** at the start of each of your rounds, so you can re-pay every round.

### Design intent

- Because threads start **up**, plain up-arrows are "round 1" costs. Arrows pointing right/down/left must be **woven ahead** (see §3) before the card unlocks — rotating a thread is an investment in a future play.
- Because a colour's arrows demand that colour's threads, **loom composition is a hard deck-building constraint** (see §7): a card with two azure arrows requires a loom holding at least two azure threads, or it can never be cast.
- Rotating has tension: turning a thread away from up unlocks new costs but can strand cards that still need up-arrows.

## 3. The round

**Before the first round — the mulligan.** Each weaver looks at their opening hand (4 cards) and may shuffle **any of those cards back into their deck**, then draws that many fresh ones (an empty pick keeps the hand). One mulligan per weaver, taken in either order — the moment both have decided, round 1 begins with the starting weaver's normal round-start draw. In the client, click cards in your hand to pick them and confirm via the bar above your loom.

Players alternate rounds. Your round, in order:

1. **Round start** — all your threads ready; draw a card. If your deck is empty your pattern frays: you lose 1 life per missed draw.
2. **Main step** — act in any order, any number of times:
   - **play** cards from hand (exhaust threads to pay),
   - **move** a back-row unit forward (same lane, front slot free, once per round per unit),
   - **attack** with front-row units (a declaration: the unit exhausts — see §4).
3. **Weave step (optional)** — rotate **one** of your threads 90° clockwise or counter-clockwise. Once per round.
4. **End round** — pass to the opponent.

Units cannot attack the round they are played unless they have **Quickstride**.

Outside your round you can still act: **Reaction** spells may be cast at any time it is not your own round (§6), landing on the shared **spell stack** (§5) on top of whatever is already there — and manual actions (§6.1) are always open to either weaver.

## 4. The board

3 lanes × 2 rows (front/back) per player = 6 slots on your side (12 on the board). Units enter any free slot; one unit per slot — the one exception is a **stack**: an effect that explicitly allows it (Animate, §6) may hold several Animated units in a single slot.

**Combat** — only front-row units attack, into their own lane. Clicking the ⚔ badge on an eligible unit **starts the combat: the unit exhausts, and that is everything the engine does.** The damage itself is applied by hand via manual actions (§6.1), following defender priority:

1. Enemy **front** unit in the lane → the two units deal their power to each other simultaneously. A **stack** attacks with its combined power, and the defender's retaliation is split among the stack's members **as the attacking player chooses** — one retaliation can never kill more than one member of the stack.
2. Only an enemy **back** unit in the lane → your unit hits it with no retaliation.
3. Empty lane → your unit hits the enemy weaver directly.

## 5. Zones & winning

Zones: loom, hand, battlefield, deck, **discard** (graveyard), **purge** (exile) — plus the **spell stack**, the game's one shared spell slot (see below).

**The spell stack** is a single shared zone between the weavers. Casting a spell pays its cost and places it on the stack instead of discarding it — **both weavers' spells (and their Reactions) stack up in the same slot, in cast order**. Nothing resolves automatically: the stack is resolved **by hand, top-down** — the newest spell (the top) resolves first, then the next under it, each ending in its **caster's** discard when resolved or countered. The battle screen shows the stack as a strip under the battlefield: leftmost is the top ("resolves next"), with each spell's caster and resolution order badged on it. The stack is public and persists across rounds until emptied by hand.

The **discard and purge piles are public** — both weavers see their contents (each player's bar shows live deck / discard / purge piles; clicking discard or purge opens the pile's cards, and any card in them can be right-clicked to send it elsewhere). Decks and hands stay hidden: the deck renders as a count, and only its owner may peek at it.

**Win** by reducing the enemy weaver to 0 life (both start at 20), or by concession. Each player draws one card per round — empty decks bleed life, eventually lethally.

## 6. Keywords & effects

- **Quickstride** — the unit can attack the round it is woven.
- **Excite** — put an excite token on one of your threads; the token sits there until unleashed.
- **Unleash** — spend excite tokens to pay for an effect: "Unleash LEFT" removes a token from a left-pointing thread, "Unleash UP UP" removes two tokens from up-pointing threads.
- **Doom** — a deathrattle: the effect triggers when the unit dies.
- **Kill** — the effect triggers when this unit kills an enemy unit.
- **Hunt** — when this unit attacks, it may first move into an adjacent lane that holds an enemy front-row unit, attacking into that lane instead.
- **Reaction** — the spell may be cast outside your own round: any time it is not your turn, even mid-stack. It pays its threads like any cast and goes **on top of the shared spell stack** (§5) — so it resolves *before* the spell it answers. The client highlights payable Reactions in your hand during the opponent's round (a "reaction window" pill appears); Reactions without a payable cost are not offered.
- **Ability** — activated unit text; usable once per round.
- **Sprout** — create a **Threadling** token in your loom.
- **Threadling** — a colourless token thread. It points **up** by default and may be rotated during the end step. It is never exhausted to pay: it is **sacrificed** to pay **any one arrow** of a cost, ignoring colour and orientation. The loom has no size cap — Threadlings grow it past four threads. A Threadling can also be **sacrificed outright** — right-click it in the loom (§6.1); real threads cannot be sacrificed away.
- **Animate** — move a thread from your loom to the battlefield, where it becomes a unit: a Threadling becomes a **1/1**, one of your own threads a **2/2**. When an Animated unit dies, its thread returns to your loom. Effects may allow **several Animated units in one slot** — a stack (see §4) that attacks with its combined power.
- **Cost arrows in text** — `-UP -> ⟨effect⟩` is a payment gate: exhaust a thread pointing that way to get the effect, on top of any other costs stated.
- Effect vocabulary (spells and "when woven" triggers): damage a unit, damage the enemy weaver, heal your weaver, buff/debuff a unit, draw cards, **ready** an exhausted thread, **rotate** a thread 90° in a chosen direction, **excite** a thread and **unleash** its token, return a unit to its owner's hand, destroy a low-power enemy unit, make the enemy purge deck cards, **sacrifice** a unit, **sprout** a Threadling, **animate** a thread.

### 6.1 Manual resolution

The engine never resolves card effects or combat damage. Playing a spell pays its cost and puts it on the shared spell stack; weaving a trigger unit pays its cost and deploys it; attacking exhausts the attacker. The players apply the outcome themselves through **manual actions**, fired from **right-click context menus** on the board (the one panel exception: the **Add token** button in the chronicle panel on the right):

- **Right-click a stack spell** (or use the stack strip's **✔ Resolve top** button): **Resolve** (its effect is applied by hand, then it leaves for its caster's discard) or **Counter** (it fizzles to the caster's discard unresolved — the manual verb behind *The Stars Align*), or send it elsewhere (hand / deck / purge) for playtesting. Resolution follows the visualized order: top first.

- **Targeting arrows (visual only)** — either weaver may draw an arrow from a card in play to a unit to show what it is aiming at. Hover a spell on the stack or any unit and **press T**, or click the **🎯 badge** that appears in the card's top-right corner on hover (both also sit in the right-click menu), then **click a unit** — a gold arrow is drawn from the card to that unit. The arrows are purely informational — no rules effect — but they are **server-synced and public**: both weavers always see every arrow, which is how the table knows whether a waiting spell is targeting anything. One arrow per card: clicking a different unit re-points it, clicking the same unit again clears it, and **right-clicking the card → *clear targeting*** wipes it. An arrow vanishes automatically the moment either end leaves play (the spell resolves, is countered or moves; the unit dies, returns to hand or is sent elsewhere). Pressing T again or Esc cancels mid-marking.

- **Right-click a unit** (either side): deal damage, adjust power / health (steppers, signed), return to owner's hand, destroy, or send it to another area.
- **Right-click a hand card**: discard it, or send it to the deck (top/bottom) or purge.
- **Right-click a thread** (either loom): rotate 90° clockwise or counter-clockwise, ready or exhaust it, **excite** it (put an excite token on it — shown as a ✦ badge on the chip) or **unleash** (spend one of its tokens, offered only while it holds one) — or **Animate** it into a free slot on its owner's side (Threadling → 1/1, one of the weaver's own threads → 2/2; when the Animated unit dies, the thread returns to the loom with its excite tokens intact). Threadlings additionally offer **sacrifice** — removed from the loom outright. During your own weave step the legal weave is offered in the same menu.
- **Add token button** (right panel): sprouts a token into either weaver's loom — one token exists, the **Threadling**. This is the manual verb behind **Sprout**.
- **Right-click a deck pile** (either side): draw N, purge top N, shuffle — and for your own deck, *look at top N* (a private peek panel; only you ever see those cards, and it refreshes automatically as the deck changes).
- **Discard / purge piles**: click to view their cards; right-click a card inside to send it to hand, deck top/bottom, or the other pile.
- **Weaver life**: each player bar has **− / +** buttons (±1 life per click).

Every change to life, unit power and unit health is shown as a **floating delta indicator** (`+2` / `−2`) next to the affected number instead of a silent value swap.

- **Unrestricted by design**: either weaver may fire manual actions at any time, even outside their turn — no turn gating, no legality enumeration. Cross-player moves are legal (you may rotate an enemy thread or send an enemy unit to hand); the only hidden-information rule is that `peek_deck` targets your own deck.
- The server validates that targets exist and amounts are whole numbers (clamped to ±999); every resulting state change (life, unit health, zones, threads, decks) is tracked server-side, and a weaver hitting 0 life still ends the game.
- The manual verbs cover the full effect vocabulary plus combat damage and playtest tools: `damage_unit`, `damage_face`, `heal_face`, `buff_unit`, `draw`, `ready_thread`, `exhaust_thread`, `rotate_thread`, `return_to_hand`, `destroy_unit`, `purge_deck_top`, `peek_deck`, `shuffle_deck`, `move_card` (send any card in any zone — **including the spell stack** — to hand / deck top / deck bottom / discard / purge), `add_token` (sprout a Threadling into either loom), `animate_thread` (loom thread → battlefield unit on its owner's side; death returns the thread), `excite_thread` / `unleash_thread` (put an excite token on a thread / spend one — the manual verbs behind Excite and Unleash), `sacrifice_threadling` (remove a Threadling from its loom outright), `resolve_spell` (a spell leaves the shared stack for its caster's discard — resolved, or `countered: true` to fizzle it) and the visual-only `set_target` / `clear_target` (draw / erase a targeting arrow from a card in play to a battlefield unit — one arrow per source, unlogged, pruned when either end leaves play). Animated threads are real cards — they can be damaged, buffed and sent to other areas like any unit.

## 7. Deck construction

- **20–30 cards**, max **2 copies** of any one card.
- You also choose your **loom composition**: exactly 4 thread colours.
- **Constraint:** for every card in the deck, your loom must hold **at least as many threads of each cost colour as the card's most demanding single cost** — e.g. a deck running Dawn Star (`azure:up + azure:up`) needs ≥ 2 azure threads. `any` arrows demand nothing. Enforced server-side at game creation and client-side in the deck builder.
- Typical looms are 2+2 (e.g. Crimson/Crimson/Azure/Azure). Mono-colour looms (4× one colour) maximise that colour's heavy cards but lose `any`-arrow flexibility... and every other colour.

## 8. Built-in card catalog (36 cards)

Costs below are written as `Colour ↑` arrows. The catalog lives in `server/src/domain/card/CardDefinitions.ts` and **mirrors the three published colour sheets (§9) one for one** — same cards, same ids the CSV loader slugifies — so a configured `CARD_CSV_URL` and the zero-config fallback deal the same game. Card text is the sheets' prose `effect` column, resolved by hand per §6.1. Economy reference: the **amber** price list in **[docs/amber.md](amber.md)**; Azure's Constellation/Chart mechanics, CSV block and audit live in **[docs/azure.md](azure.md)**.

### Cost lanes

Each orientation is a lane, not just a number of arrows:

- **↑ Up** — activated abilities and early-game units. Round-1 currency (threads start up). Baseline: **↑ ↑ ↑ = 2/2**.
- **→ Right** — mid-game units (one weave to unlock). Baseline: **→ ↑ = 3/4**.
- **← Left** — spells (one weave to unlock). Baseline: **← = cantrip**, **← ← = 4–5 damage**.
- **↓ Down** — greater unit stats (two weaves to unlock). Baseline: **↓ ↑ = 6/6**. Aside from special ritual occasions, spells don't use DOWN — heavy spell effects belong on **← ←**.

You have more ↑s early and more ←/→/↓s late: every weave rotates a thread *away* from up, so cheap up-costs strain as the game drags while rotated threads power the heavy cards. Units never cost ← and spells never cost →; the triple-arrow cards (Sporic Arouser, Riff Aggressor, Astral Scribe, Reil, Sivil) demand three threads of a single colour, pushing their decks toward mono or 3+1 looms.

### Crimson 🌋 — Riff (excite/unleash economy)

| Card | Atk/Hp | Cost | Text |
|---|---|---|---|
| Riff Larva | 1/1 | Crimson ↑ + Crimson ↑ | Doom: Excite. |
| Riff Eater | 2/1 | Crimson ↑ + Crimson ↑ | Played: Discard 1 -> Excite. |
| Riff Aggressor | 4/1 | Crimson ↑ + Crimson ↑ + Crimson ↑ | Played: Your opponents draw 1. Unleash DOWN to not. |
| Riff Crawler | 1/1 | Crimson → | Played: Unleash DOWN -> Draw 1. |
| Riff Shrieker | 2/2 | Crimson → + Crimson ↑ | Played: Unleash UP -> Gain +2/+2. |
| Riff Hunter | 3/3 | Crimson → + Crimson → | Hunt. Kill: Excite. |
| Wyrmbite | spell | Crimson ← | Reaction. Played: Deal 2 damage to any front-row unit. Unleash LEFT to draw 1. |
| Hunting Extincts | spell | Crimson ← | Played: Grant a friendly unit Hunt and +1/+0 this round. Excite. |
| Enrage | spell | Crimson ← + Crimson ↑ | Reaction. Played: Give a unit +2/+1 this round. Unleash LEFT to draw 1. |
| Encore | spell | Crimson ← + Crimson ↑ | Played: Draw 1, Excite. Unleash LEFT -> Draw 1. |
| Riri, Riff Star | 3/5 | Crimson ↓ + Crimson ↑ | The first time you unleash each turn, deal 2 damage to the enemy champion. |
| Reil, Riff Devourer | 5/4 | Crimson ↓ + Crimson ↑ + Crimson ↑ | Kill: Excite and Draw 1. |

### Verdant 🌿 — Sporic (Threadling/animate economy)

| Card | Atk/Hp | Cost | Text |
|---|---|---|---|
| Sporic Sapling | 1/1 | Verdant ↑ + Verdant ↑ | Doom: Sprout. |
| Sporic Agent | 1/1 | Verdant ↑ + Verdant ↑ | If you have another unit in this lane, this has +1/+1. |
| Sporic Arouser | 2/1 | Verdant ↑ + Verdant ↑ + Verdant ↑ | Your front-row units here has +1/+0. |
| Sporic Trader | 2/2 | Verdant → | Played: Sprout. |
| Sporic Animater | 2/2 | Verdant → + Verdant ↑ | Doom: Sprout, then Animate. |
| Sporic Strategist | 3/3 | Verdant → + Verdant → | Ability: Sacrifice a friendly unit, -UP -> Draw 1. |
| Guards! | spell | Verdant ← | Reaction. Played: Animate, give it +2/+0 this round. |
| Together Strong | spell | Verdant ← | Played: Choose a unit, give it +1/+1 this round for each front-row unit you have. |
| Bonds of Strength | spell | Verdant ← + Verdant ↑ | Reaction. Played: Give all your front-row units +2/+0 this round. |
| Sacrifice | spell | Verdant ← + Verdant ↑ | Played: All players must sacrifice a unit if possible. |
| Sire, Sporic Commander | 3/3 | Verdant ↓ + Verdant ↑ | Your front row units have +1/+1. |
| Sivil, Spore Mother | 4/4 | Verdant ↓ + Verdant ↑ + Verdant ↑ | The first time you Animate each turn, this gains +1/+1. |

### Azure ☁️ — Astral (constellation economy)

| Card | Atk/Hp | Cost | Text |
|---|---|---|---|
| Dawn Star | 1/1 | Azure ↑ + Azure ↑ | Played: Constellation 4 - This can attack immediately. |
| Astral Mothling | 1/1 | Azure ↑ + Azure ↑ | Doom: Weave. |
| Astral Scribe | 2/1 | Azure ↑ + Azure ↑ + Azure ↑ | Whenever you play a unit, Chart 1. |
| Astral Ladybug | 1/2 | Azure → | Constellation 3 - This has +1/+1. |
| Astral Weaver | 2/2 | Azure → + Azure ↑ | Ability: -UP, UP -> Weave. |
| Astral Serratist | 3/3 | Azure → + Azure → | Kill: Weave |
| Starstruck | spell | Azure ← | Reaction. Played: Choose a unit, give it -1/-1 this turn. Constellation 3 - Chart 2. |
| Starfall | spell | Azure ← + Azure ↑ | Played: Deal 2 damage to any front-row unit. Constellation 3 - You may repeat this effect. |
| Grand Conjuncture | spell | Azure ← + Azure ↑ | Played: Weave twice or Draw 2. |
| The Stars Align | spell | Azure ← + Azure ← | Reaction. Counter target spell. Constellation 3 - Chart 2. |
| Alia, Astral Aligner | 4/4 | Azure ↓ + Azure ↑ | Played: Reveal the top card of your deck, the cost of that card adds to your total Constellation this turn. Constellation 4 - Deal 6 damage to any front-row unit. |
| Arsdeth, Deathstar | 5/5 | Azure ↓ + Azure ↓ | Doom: Deal damage equal to your constellation to the enemy Champion. |

## 9. CSV catalog format

Card data can come from published Google Sheets CSVs (`CARD_CSV_URL` env var; `/pubhtml` links are auto-normalized). The var holds **every sheet URL, separated by commas or whitespace** — point it at all your published colour tabs; each row's `type` column decides unit vs spell (and sets the card's category), duplicate card ids are skipped. Header names are normalized (lowercase, spaces/dashes → underscores). A failed sheet is skipped (the rest still load); the built-in catalog applies only when no sheet loads.

**Published colour sheets** (design-stage lists; the `effect` column is prose shown as card text and resolved by hand per §6.1; each sheet's colour is a loom-pickable thread colour):

- Crimson — excite/unleash economy: [Crimson sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vTAW7tvQ4UIPnMCK_AlgF2fXzE3H9lIDrcJSOT9cROaCxlEbV8wBFIaGcwL_8JnNPU2rKib7geOd9oZ/pub?gid=0&single=true&output=csv)
- Verdant — Threadling/animate economy: [Verdant sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vTAW7tvQ4UIPnMCK_AlgF2fXzE3H9lIDrcJSOT9cROaCxlEbV8wBFIaGcwL_8JnNPU2rKib7geOd9oZ/pub?gid=1378402100&single=true&output=csv)
- Azure — alignment economy: card list, CSV block and audit in [docs/azure.md](azure.md), published [Azure sheet](https://docs.google.com/spreadsheets/d/e/2PACX-1vTAW7tvQ4UIPnMCK_AlgF2fXzE3H9lIDrcJSOT9cROaCxlEbV8wBFIaGcwL_8JnNPU2rKib7geOd9oZ/pub?gid=137551134&single=true&output=csv)

| Column | Aliases | Format |
|---|---|---|
| `title` | `name` | required — row skipped without it |
| `card_id` | `id` | optional, defaults to slugified title |
| `type` | | `unit` or `spell` (anything but "spell" = unit) |
| `colour` | `color` | `crimson` / `azure` / `verdant` / `neutral` (case-insensitive; the draft sheets write `CRIMSON` / `AZURE` / `VERDANT`) |
| `cost` | | `colour:orientation` entries separated by `+`, `,` or spaces — e.g. `crimson:up + crimson:left`, shorthand `c:u c:l`, wildcard `any:down` |
| `orientation_req` | `orientation` | legacy column — forces the last entry's orientation |
| `attack` | `power` | number |
| `health` | | number |
| `haste` | `quickstride` | `true` / `yes` / `1` |
| `reaction` | | `true` / `yes` / `1` — spells only; if the column is absent, a card text beginning with "Reaction." marks it |
| `effects` | | JSON array (see §6 vocabulary), e.g. `[{"kind":"damage_unit","amount":2,"scope":"any"}]` |
| `on_play` | | JSON array for "when woven" triggers |
| `text` | `description`, `effect` | rules text shown on the card — the published draft sheets put their prose in `effect` |
| `rarity` | | defaults to `common` |

**Legacy compatibility:** a bare orientation token (`up left`) uses the row's own colour (or `any` for neutral rows); a bare number `N` becomes N × `<row colour>:up`; the old `orientation_req` column re-points the final entry.

### Cost notation cheat-sheet

| Written | Meaning |
|---|---|
| `crimson:up` / `c:u` | one crimson thread pointing up |
| `any:down` / `down` | one thread of any colour pointing down |
| `2` | two of the row colour's threads pointing up (legacy) |
| `crimson:up + azure:left` | one crimson up **and** one azure left (multi-colour "gold" costs are legal) |

## 10. Where things live

- **Rules** — `server/src/domain/rules/LoomRuleSet.ts` (payment, combat-as-declaration, the shared spell stack, Reaction legality, manual effect application, turns, the opening mulligan, deck & loom validation)
- **Opening mulligan** — `MulliganAction` in `server/src/domain/actions/GameAction.ts`; during the start-of-game `mulligan` phase both weavers at once (turn-ungated in `BattleEngine`) are offered **every subset of their hand** as a `mulligan` action — the empty pick keeps it. Taken once per weaver (`state.metadata.mulliganed` flags, cloned like `weaved`); `applyMulligan` shuffles the picks into the deck, redraws that many, and starts round 1 (incl. the first player's round-start draw) once both have decided. The `mulliganed` map ships publicly in `sanitize.ts`; `game-view.js` renders click-to-pick hand cards, the mulligan bar (Shuffle back & redraw / Keep hand) and a waiting note for the decided weaver
- **Spell stack** — `parseSpellStack`/`SpellStackEntry` in `LoomRuleSet.ts`; stored as `{ card, casterId }` entries (bottom-first) in `state.metadata.spellStack`, cloned with the state, shipped **top-first and public** to both views as `spellStack` in `sanitize.ts`; rendered by the `#spell-stack` strip in `game-view.js` (newest left = resolves first, caster + order badges, resolve/counter context menu, **✔ Resolve top** button)
- **Targeting arrows** — `parseTargetArrows`/`TargetArrow` in `LoomRuleSet.ts`; one `{ sourceCardId, targetCardId }` per card in play, stored in `state.metadata.targetArrows` (a manual-action zone: `set_target`/`clear_target`, unlogged), pruned after every action once either end leaves the battlefield/stack, and shipped **public** to both views as `targetArrows` in `sanitize.ts`. `game-view.js` renders them on the fixed `#target-arrows` SVG overlay (curved gold arrows with a live rubber-band preview while marking), driven by the **T** key over a card in play, the 🎯 hover badge on every unit & stack spell, and *target a unit…* / *clear targeting* context-menu entries
- **Manual actions** — `ManualAction` in `server/src/domain/actions/GameAction.ts`; exempt from turn/legality gating in `BattleEngine`, applied by `applyManualAction` (incl. `move_card`, `peek_deck`, `shuffle_deck`, `exhaust_thread`)
- **Deck peeks** — `DeckPeekMetadata`/`parseDeckPeeks` in `LoomRuleSet.ts`; stored as card ids in `state.metadata.deckPeek`, re-snapshotted after every action, shipped **only** to the peeking player's view in `sanitize.ts`
- **Cards** — `server/src/domain/card/CardDefinitions.ts` (built-in catalog + cost parser), `Card.ts` (`CostEntry` + `CardEffect` types)
- **CSV ingestion** — `server/src/infrastructure/cards/csvCatalog.ts`
- **Accounts & login** — `server/src/infrastructure/persistence/JsonAccountStore.ts` (`DATA_DIR/accounts.json`, unsalted sha256 — playtest-grade, not production auth), `server/src/infrastructure/auth/tokens.ts` (stateless HMAC bearer tokens), routes in `http/routes/authRoutes.ts`; deck CRUD is account-scoped at `/api/decks`, lobby seats bind to accounts in `lobby/LobbyState.ts` (`playerAccounts`)
- **Client sessions** — `server/public/js/shared.js`: sessions in `sessionStorage` (per browser tab) so one browser can hold both seats for local playtesting; `login.html` + `js/login.js` handle register/login (`?switch=1` forces a fresh login for the second-seat link). The Deck Builder link navigates in the **same tab** — a new tab gets a fresh `sessionStorage` (Firefox/Safari give it nothing, Chrome a frozen copy), which would force a re-login. The current room is remembered twice: per tab in `sessionStorage` (`manaweave.lobby`, written by `enterRoom` — refresh recovery) and per account in `localStorage` (`manaweave.room.<accountId>`) so a fresh tab or a re-login re-enters the room without the code — the server's join endpoint returns the account's existing seat. An explicit `?join=CODE` link outranks the remembered room; only the tab's own room can pre-empt it. When a match ends, the server settles its room back to *waiting* (seats and deck picks kept — `settleFinishedGame` on the `game_finished` event), so returning to the lobby after a win or concession re-opens the room for a rematch instead of redirecting back into the finished game; a *live* match still captures room recovery (refresh protection).
- **Client views** — `server/src/domain/game/sanitize.ts` (cost pairs as `{colour, orientation}` JSON; discard/purge piles public, deck peeks owner-only)
- **Context menus** — `server/public/js/context-menu.js` (right-click menus: actions, submenus, −/+ steppers); wired into every card/thread/pile by `game-view.js`, which also renders the zone piles, life −/+ buttons, peek panel, pile viewers, the right-panel **Add token** picker (Threadling → either loom) and the floating `+N/−N` delta indicators
- **Tests** — `server/src/test/domain-test.ts` (`npm run test:domain`, 172 checks incl. the opening mulligan, manual actions, zone moves, deck peeks, excite/unleash, Threadling sacrifice, CSV catalog mapping, the shared spell stack & Reaction casting, and the visual targeting arrows)
- **Architecture & running** — see the root `README.md`
