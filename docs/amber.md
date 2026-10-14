# ManaWeave — The Amber List

**Amber** is ManaWeave's balancing currency. Every arrow in a card's cost grants a **budget** of amber; every stat point and effect on a card has a **price** in amber. A card is fairly costed when its price lands within slack of its budget. When you add or retune a card, compute both numbers — the delta tells you which way it's broken.

The whole system is derived from five baselines, which come out at exact parity:

| Baseline | Cost | Budget | Price |
|---|---|---|---|
| Early unit | ↑ ↑ ↑ | 3 | 2/2 = 3 |
| Mid unit | → ↑ | 5 | 3/4 = 5 |
| Big unit | ↓ ↑ | 9 | 6/6 = 9 |
| Cantrip | ← | 4 | draw 1 = 4 |
| Burn | ← ← | 8 | 4–5 damage = 8–10 |

---

## 1. Arrow budgets — what a cost lets you spend

| Arrow | Orientation | Amber | Why |
|---|---|---|---|
| ↑ | up | **1** | Threads start up — round-1 currency. Weakest per arrow. |
| ← | left | **4** | One weave away (up → left), live from round 2. The spell lane. |
| → | right | **4** | One weave away (up → right), live from round 2. The unit lane. |
| ↓ | down | **8** | Two weaves away (up → right → down). Big-unit stats (↓ ↑ = 6/6) and ritual specials — ordinary heavy spells belong on ← ←. |

- **← and → are worth the same** because they cost the same to reach: one rotation from up, playable from round 2. What separates them is not value but *permission* — the cost lanes (§6) forbid units from costing ← and spells from costing →. A left-pointing thread and a right-pointing thread buy the same 4 amber; you just can't spend them on the same things.
- **Grey `any` arrows are worth half** their orientation's value (↑ 0.5, ← 2, → 2, ↓ 4): any thread can pay them, so they buy less. This is why neutral cards run lean.
- **Weft bonus:** a cost of *exactly one ↑ arrow* gets **+1 budget** (coloured or grey). Single-arrow plays are your whole early tempo — the bonus keeps 1-drops and cheap tricks viable without breaking the baselines.

### Timing: more ↑s early, more ← → ↓s late

You rotate **one** thread 90° per round, so orientations come online in waves — and every rotation away from up shrinks your ↑ supply, stranding late-game hands full of cheap up-costs:

| Round shape | Loom | Amber per round |
|---|---|---|
| Round 1 | ↑ ↑ ↑ ↑ | 4 |
| After 1 weave | ↑ ↑ ↑ ← (or →) | 7 |
| After 2 weaves | ↑ ↑ ← → | 10 |
| | ↑ ↑ ↑ ↓ | 11 |
| Late game | ↑ → ↓ ↓ | 21 |

A ↓ thread is a ritual: two weaves of investment, then +8 amber every round — but it can no longer pay ↑ costs. Budgets above ~6 amber assume this late-game availability and should not appear on ↑-heavy costs.

---

## 2. Stat prices — units

| Stat | Amber |
|---|---|
| Power | **1 per point** |
| Health | **0.5 per point** |

### Vanilla ladder (budget → what it buys)

| Cost | Budget | Fair body / effect |
|---|---|---|
| ↑ (weft bonus) | 2 | 1/2, 2/1 glass, 1/1 + Quickstride, 1 damage, +2 power, heal 4, ready a thread |
| ↑ ↑ | 2 | 1/3 |
| ↑ ↑ + ↑any | 2.5 | 2/2, 3/1 glass |
| ← (or →) | 4 | **cantrip**, 2 damage, bounce, +3/+3, mill 4 |
| → ↑ | 5 | **3/4** (baseline), destroy ≤ 3 power, draw 1 + heal 2 |
| → ↑ + ↑any | 5.5 | 4/3, 3/5, 3/3 + Quickstride, 2/3 + gain 3 |
| ← ↑ | 5 | rotate a thread + draw 1 |
| ← ← | 8 | **4–5 damage**, draw 2, +4/+4 & heal 4, destroy any unit — the heavy-spell tier |
| ↓ ↑ | 9 | **6/6** (baseline) |
| ↓ ← | 12 | ritual specials — draw 3 |
| ↑ ↓ + ↑ ↑ (whole loom) | 10 | 7/6, 6/7 |

---

## 3. Effect prices — spells & when-woven triggers

| Effect | Amber | Notes |
|---|---|---|
| Deal 1 damage (unit or weaver) | **2** | Anchored: ← ← = 4–5 damage. |
| Weaver heals 1 | **0.5** | Life gain is a quarter of damage — pure defence. |
| Draw a card | **4** | Anchored: ← = cantrip. Cards are the premium resource. |
| Buff/debuff ±A/±H | **A + 0.5×H** | Same as stats; −1/−2 = 2. |
| Quickstride (haste) | **1** | Flat at any body size — attacking a round early is one amber of tempo. |
| Ready a thread | **2** | Priced at its early-game floor (re-readying an ↑); re-readying a ↓ late is the premium use. |
| Rotate a thread | **1.5** | A weave on demand — unlocks ← and → costs, progresses ↓. |
| Return enemy unit to hand | **4** | One ←: answers anything but gives them the re-cast. |
| Destroy enemy unit ≤ 3 power | **5** | ~1.5 per power point of the ceiling (≤ 5 power = 7). |
| Destroy any enemy unit | **8** | A ← ← spell. |
| Enemy purges 1 deck card | **1** | Mill is slow burn (empty decks cost 1 life per missed draw). |
| When-woven trigger | **effect price** | Added on top of the body (1/1 + draw = 5.5 → → ↑). |
| Doom (deathrattle) | **effect price** | Added on top of the body, like a when-woven trigger; the opponent controls the timing. |
| Excite a thread | **1.5** | An investment, not purchasing power — see §3.1. Anchored to rotate-a-thread (1.5) and Encore's residual value. |
| Unleash (as a cost) | **−1.5** | Burns one excite token. The orientation gate is timing, not amber — see §3.1. |
| Sprout (create a Threadling) | **1** | A one-shot wildcard payment, floor-priced at the ↑ the token defaults to — see §3.2. |
| Animate a Threadling | **0.5–1** | A 1/1 body bought with ~1 of sacrificial currency; the token returns on death. |
| Animate one of your threads | **1–2** | A 2/2 body minus the loaned payment; the thread returns on death. |
| Hunt | **1** | Flat at any body size. Trade-selection only: it moves the attacker into adjacent lanes that hold enemy front-row units — not face evasion. |
| Reaction | **+0.5** | Casting-time flexibility premium, Quickstride-adjacent. |

### 3.1 The excite-token economy (CRIMSON)

- **A token is a claim check, not purchasing power.** Amber prices value at the moment of casting; an excite token has none yet — it is redeemed later, on the Unleash card. The engine's spread (make at 1.5, redeem at the effect's price) is intentional: each side of the combo pays its own budget, and the spread rewards the deck constraint. The failure mode is *concentrating redemption* — one card that unleashes repeatedly multiplies the spread (see the repeatable rule below).
- **Unleash orientation gates are timing, not amber.** Unleash ↑ is live round 1; Unleash ↓ needs two weaves and cannot fire before round 3 — audit ↓-gated riders with the §4 ritual lens, exactly as ↓ costs.
- **Repeatable unleash triggers price at two firings.** A passive ("when you unleash, ⟨effect⟩") is audited as body + 2 × (effect − 1.5). Landing under budget at one firing is an acceptable floor at legendary only.
- **Self-seeding loops:** if a token may be unleashed the same round it is placed, audit the card at full combo value (Encore as written would be draw 2 on a ← ↑ budget — above the ← ← rate). Restricting same-round unleash keeps those cards at their base price.

### 3.2 The Threadling economy (VERDANT)

- **A Threadling is a wildcard, not a thread.** It is sacrificed — removed, not exhausted — to pay any one arrow, colour and orientation ignored. Its purchasing power is therefore the budget of whichever arrow it completes; Sprout is floor-priced at 1 (the ↑ the token starts as), and riding the spread is the skill. Decks that routinely cash Threadlings into ← ← or ↓ arrows are drawing 4–8 budget per token — if that shows up in playtests, Sprout is a 1.5–2 and every Sprout card shifts +0.5 hot.
- **Animate is a loan, not a loss.** The thread parks its payment inside a body (Threadling 1/1, real thread 2/2) and is refunded when the body dies — price the body minus the loaned payment, not the body alone.
- **Stacks compound.** A slot of Animated units attacks with combined power, and because the attacker splits the retaliation, one combat can never kill more than one member — whose thread returns anyway. Audit stacking engines at two firings plus a ~1–2 concentration bonus; Sivil as written sits at +1…+2 hot, the tribe's deliberate top end.
- **No loom cap.** Sprout engines grow the loom all game; §1's timing model assumes ~4 threads, so late-game Threadling decks run richer than any single card's budget can express. That is the Sporic identity — price with it in mind, playtest with both eyes on it.

### 3.3 The alignment economy (AZURE)

- **Weave (an extra weave) — 1.5 amber.** An effect that says "Weave" performs an additional weave step: rotate one of your threads 90°, on top of (not instead of) the round's weave. Priced at rotate-a-thread; the premium is timing, not amplitude. "Weave twice" = 3.
- **Constellation is a number: gates are half-price, totals run ~1.5 per point.** Your Constellation is the size of your largest group of same-orientation threads — exhausted threads count (exhaustion flips readiness, not bearing) and Threadlings count (they point up). Dawn caveat: every loom starts Constellation 4, so a gate on an early card audits as *unconditional* against the round it actually lands; totals in effects are bounded at 4 on a standard loom but grow with Verdant's Threadlings. Temporary Constellation bonuses (Sivil's reveal) price at their expected contribution (~0.5–1) plus whatever gate they unlock.
- **Chart 1 = 1, Chart 2 = 2.** Selection is half a card (draw is 4). Charting immediately before a draw compounds — a card that Charts then draws is worth about +0.5 over the sum of its parts.
- **Counters — ~6 amber.** The Stars Align introduces the game's first counter: the spell's cost was paid but nothing resolved. Against destroy-any-unit (8) it trades targeting breadth for "never happened" — and it is dead against units, which is worth real amber. Resolves by hand: the countered card simply goes to discard without applying its effect.
- **Failure modes:** per-unit-play Chart triggers (Astral Scribe) compound like repeatable unleash triggers — audit at 2+ firings or gate to once per round (§3.1); a mass-weave ritual into a Constellation total (Grand Conjuncture feeding Alia's Doom) is a two-card combo — audit the pair together, not each half.

The card list, CSV block and per-card audit live in **[docs/azure.md](azure.md)**.

---

## 4. Slack policy — and the limits of amber

Amber prices purchasing power *at the moment of casting*. It deliberately ignores **when** that moment comes — and ManaWeave has expensive early-game cards and late-game cheap cards, an axis most games can't even express. A 3×↑ card on round 1 commands three quarters of your loom; five rounds later it's spare change if you kept threads up. A ← ← spell is dead weight for two rounds, then steadily becomes trivial. Amber cannot see any of that. Treat it as a floor check, not a verdict:

- **≥ 3 amber budget:** within **±0.5**.
- **≤ 2.5 amber budget (tempo country):** up to **+1 hot** — cheap plays trade efficiency for board presence. Crimson's early curve lives at that cap; other colours stay ≤ +0.5.
- **Ritual discount:** anything uncastable before round 3 (a ↓ anywhere in the cost, or a whole-loom cost) may run **−0.5 under** — the delay is real payment. Hence the ↓ ↑ giants sit at exact parity while the whole-loom 6/7 runs a touch under.
- **Face damage** may run **+0.5 beyond normal slack**: reach closes games, and the baselines price it at the top of the ← ← band (5 damage at 8–9 budget). Face damage above 8 needs a ritual-tier cost.
- After the numbers pass, ask what amber can't: **when does this card actually hit the table, what does the opponent have by then, and does the loom even point that way yet?** A card that only ever comes down late is judged against late-game threats; an always-castable ↑ card is judged against the whole game's tempo.

---

## 5. Catalog audit — built-in list (14 cards)

Budget = arrows + weft bonus (single-↑ costs only); Price = stats + effects. Δ = Price − Budget.

### Verdant 🌿 — growth, buffs, staying power

| Card | Cost | Body/Effect | Budget | Price | Δ |
|---|---|---|---|---|---|
| Sapling Warden | 🌿↑ | 1/3 | 2 | 2.5 | +0.5 |
| Wildwood Elk | 🌿↑ 🌿↑ ⬆ | 2/2 | 2.5 | 3 | +0.5 |
| Grovekeeper | 🌿→ 🌿↑ | 2/3, when woven: gain 3 | 5 | 5.5 | +0.5 |
| Thornhide Behemoth | 🌿→ 🌿↑ ⬆ | 3/5 | 5.5 | 5.5 | 0 |
| Ancient Treant | 🌿↑ 🌿↓ ⬆ ⬆ | 6/7 | 10 | 9.5 | −0.5 |
| Wildbloom | 🌿↑ | gain 4 life | 2 | 2 | 0 |
| Nature's Bounty | 🌿← 🌿↑ | draw 1, gain 2 life | 5 | 5 | 0 |
| Deep Roots | 🌿← | +3/+3 | 4 | 4.5 | +0.5 |
| Titangrowth | 🌿← 🌿← | +4/+4, gain 4 life | 8 | 8 | 0 |

### Neutral ◇ — colourless tools (any-arrows, half budget)

| Card | Cost | Body/Effect | Budget | Price | Δ |
|---|---|---|---|---|---|
| Wandering Apprentice | ⬆ | 1/1 | 1.5 | 1.5 | 0 |
| Roadwarden | → ⬆ | 2/2 | 2.5 | 2.5 | 0 |
| Mercenary Captain | → → ⬆ | 3/3 | 4.5 | 4.5 | 0 |
| Wanderer's Map | ← ← | draw 1 | 4 | 4 | 0 |
| Flash of Steel | ⬆ | +1 power | 1.5 | 1 | −0.5 |

---

## 6. Cost lanes — which arrows go on which card

- **↑ (up)** — activated abilities and early-game units. Round-1 currency; nothing above ~2.5 amber.
- **→ (right)** — mid-game units. Pair with ↑ (and optionally one grey ↑). 5–6 amber of body.
- **← (left)** — spells, always, at every tier: ← = cantrip tier (4), ← + ↑ = the 5-amber tier, ← ← = the heavy-spell tier (8) — big burn, big buffs, hard removal. Spells scale on lefts, not downs.
- **↓ (down)** — greater *unit stats* (↓ ↑ = 6/6) and special occasions only: ritual spells that nothing else can carry (Abyssal Insight's ↓ ← = draw 3). An effect that fits on ← ← belongs on ← ← — DOWN on a spell has to justify itself.

Units never cost ←; spells never cost →. The lanes are what keep same-amber arrows from being interchangeable — the loom decision (which thread do I rotate, left or right?) is the deck's plan, not a value swap. A colour never demands more than 2 arrows of its own colour per card, so a 2+2 loom can always cast its colours' whole curve.
