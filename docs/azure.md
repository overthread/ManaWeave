# ManaWeave — Azure ☁️ (design sheet)

**Azure** is the sky colour: stars, alignments, and the encoding of fate. Where Crimson runs the excite-token economy and Verdant the Threadling economy, Azure runs an **orientation economy** — the only colour that cares *which way its threads point* beyond paying costs. Every loom starts as a perfect constellation and decays as you weave; Azure is the colour that keeps re-forming the sky.

Identity: aligning, stars, sky, encoding. Third sibling sheet after Crimson and Verdant, same structure (12 cards: cheap constellation-minded units, LEFT-lane spells, a named finisher, a legendary engine).

**Published sheet:** [Azure CSV](https://docs.google.com/spreadsheets/d/e/2PACX-1vTAW7tvQ4UIPnMCK_AlgF2fXzE3H9lIDrcJSOT9cROaCxlEbV8wBFIaGcwL_8JnNPU2rKib7geOd9oZ/pub?gid=137551134&single=true&output=csv) — the sheet is the source of truth; this doc mirrors it, audits it, and lists open quirks (§6). The draft set's `Align` keyword folded into plain **Weave** effects — same loom math, cleaner vocabulary.

---

## 1. The mechanics

- **Weave (effect)** — perform an additional weave step: rotate one of your threads 90°, on top of (not instead of) your round's weave. This is Azure's pump: re-form constellations your payments broke, or march a thread toward ↓ without spending the round's weave. Amber price: **1.5**.
- **Constellation** — a *number*: the size of your largest group of threads sharing one orientation. Exhausted threads count (exhaustion flips readiness, not bearing) and Threadlings count (they point up). Used two ways: as a gate (`Constellation 3 — ⟨effect⟩`, on only while the number holds) and as a total ("damage equal to your Constellation"). Every loom starts Constellation **4** and the number decays as you weave — Azure's payoffs are free at dawn and must be rebuilt late, the inverse of every other colour's arc.
- **Chart N** — look at the top N cards of your own deck, then put them back in any order (encoding what falls next). Resolves by hand with the existing `peek_deck` + `move_card` verbs. Amber price: **Chart 1 = 1, Chart 2 = 2**.
- **Counter** *(new vocabulary, first appearance)* — a reaction that stops a spell: its cost was paid but nothing resolved. Manual resolution: the countered card goes to discard without applying its effect. Amber price: **~6**.

### The dawn tension (the colour's engine)

Round 1 the loom is Constellation 4 — every gate is on. Each weave you make (and each rotated cost you unlock) splits the sky; Azure develops by **Weaving** (extra rotations that re-stack groups) rather than by weaving *away* like everyone else. Grand Conjuncture is the burst re-set; Sivil can fake a bigger sky for a turn; Alia pays the deepest price in the game for the biggest Doom.

---

## 2. The cards (12, per the published sheet)

Costs written as azure arrows; a bare `↑` beside them is an `any` arrow (a colour never demands more than two arrows of its own colour).

| Card | Atk/Hp | Cost | Effect |
|---|---|---|---|
| Dawn Star | 1/1 | Azure ↑ + Azure ↑ | Constellation 4 — this gains Quickstride. |
| Astral Mothling | 1/1 | Azure ↑ + Azure ↑ | Doom: Weave. |
| Astral Scribe | 2/1 | Azure ↑ + Azure ↑ + ↑ | Whenever you play a unit, Chart 1. |
| Astral Ladybug | 1/2 | Azure → | Constellation 3 — this has +1/+1. |
| Astral Animater* | 2/2 | Azure → + Azure ↑ | Ability: −UP, UP → Weave. (Exhaust an up-pointing and any up thread to weave.) |
| Astral Strategist* | 3/3 | Azure → + Azure ↑ + ↑ | Kill: Weave. |
| Starstruck | spell | Azure ← | Reaction. Choose a unit: −1/−1 this turn. Constellation 3 — Chart 2. |
| Starfall | spell | Azure ← + Azure ↑ | Deal 2 damage to any unit. Constellation 3 — you may repeat this effect. |
| Grand Conjuncture | spell | Azure ← + Azure ↑ | Weave twice or draw 2. |
| The Stars Align | spell | Azure ← + Azure ← | Reaction. Counter target spell. Constellation 3 — Chart 2. |
| Sivil, Spore Mother* | 4/4 | Azure ↓ + Azure ↑ | When woven: reveal the top card of your deck; its arrows add to your total Constellation this turn. Constellation 4 — deal 6 damage to a front-row enemy unit. |
| Alia, Astral Aligner | 5/5 | Azure ↓ + Azure ↓ | Doom: deal damage equal to your Constellation to the enemy weaver. |

\* names in the sheet still carry Verdant's `Sporic` prefix (copy-paste from the template rows) — see §6.

Units never cost ← and spells never cost →, as with the sibling sheets. **Alia is the game's first `↓ ↓` cost** — both azure threads woven down (four weaves of investment total), the deepest ritual cost printed so far.

## 3. CSV block (verbatim from the published sheet)

```csv
title,color,type,cost,power,health,effect,rarity
Dawn Star,AZURE,unit,"UP, UP",1,1,Played: Constellation 4 - This gains Quick.,common
Astral Mothling,AZURE,unit,"UP, UP",1,1,Doom: Weave.,common
Astral Scribe,AZURE,unit,"UP, UP, UP",2,1,"Whenever you play a unit, Chart 1.",common
Astral Ladybug,AZURE,unit,RIGHT,1,2,Constellation 3 - This has +1/+1.,uncommon
Sporic Animater,AZURE,unit,"RIGHT, UP",2,2,"Ability: -UP, UP -> Weave.",common
Sporic Strategist,AZURE,unit,"RIGHT, UP, UP",3,3,Kill: Weave,uncommon
Starstruck,AZURE,spell,LEFT,,,"Reaction. Played: Choose a unit, give it -1/-1 this turn.
Constellation 3 - Chart 2.",common
Starfall,AZURE,spell,"LEFT, UP",,,"Played: Deal 2 damage to any unit.
Constellation 3 - You may repeat this effect.",uncommon
Grand Conjuncture,AZURE,spell,"LEFT, UP",,,Played: Weave twice or Draw 2.,common
The Stars Align,AZURE,spell,"LEFT, LEFT",,,"Reaction. Counter target spell.
Constellation 3 - Chart 2.",uncommon
"Sivil, Spore Mother",AZURE,unit,"DOWN, UP",4,4,"Played: Reveal the top card of your deck, the cost of that card adds to your total Constellation this turn.
Constellation 4 - Choose a front-row enemy unit, deal 6 damage to it.",legendary
"Alia, Astral Aligner",AZURE,unit,"DOWN, DOWN",5,5,Doom: Deal damage equal to your constellation to the enemy Champion.,common
```

## 4. Amber audit

Prices per [amber.md §3.3](amber.md): Weave 1.5, Chart 1/2 = 1/2, gates ~half the unconditional price, Constellation totals ~1.5/point, counter ~6, temporary debuff −1/−1 ≈ 1.5, draw 4, Quickstride 1. Repeatable triggers audited at 2 firings (§3.1 rule). Δ = Price − Budget: **positive = hot** (delivers more than paid), **negative = cold**.

| Card | Cost | Budget | Price (components) | Δ | Verdict |
|---|---|---|---|---|---|
| Dawn Star | AZ↑ AZ↑ | 2 | 1.5 body + 0.5–1 gated Quick | 0…+0.5 | fair — dawn-on, decays |
| Astral Mothling | AZ↑ AZ↑ | 2 | 1.5 + 1.5 Doom: Weave | +1 | hot, at the tempo cap (Riff Larva precedent) |
| Astral Scribe | AZ↑ AZ↑ ⬆ | 2.5 | 2.5 + 2×1 Chart/unit | **+2** | hot engine — see §6 |
| Astral Ladybug | AZ→ | 4 | 2 + 0.5 gated +1/+1 | **−1.5** | cold — a fair AZ→ body is ~3 |
| Astral Animater | AZ→ AZ↑ | 5 | 3 + 0.5–1 ability (1.5 weave minus a 2-arrow payment) | −1…−1.5 | cold — ability overcharges |
| Astral Strategist | AZ→ AZ↑ ⬆ | 5.5 | 4.5 + 1–1.5 Kill: Weave | 0…+0.5 | fair |
| Starstruck | AZ← | 4 | 1.5 debuff + 0.5 reaction + 1 gated Chart 2 | −1 | cold-ish, fine for a common trick |
| Starfall | AZ← AZ↑ | 5 | 4 (2 dmg) + 2 gated repeat | +1 | hot, precedented (Wyrmbite +2.5) |
| Grand Conjuncture | AZ← AZ↑ | 5 | modal: Weave ×2 (3) *or* draw 2 (8) → ~6.5–7 | **+1.5…+2** | hot — see §6 |
| The Stars Align | AZ← AZ← | 8 | 6 counter + 0.5 reaction + 1 gated Chart 2 | −0.5 | fair (counter anchor 5–7 → −1.5…+0.5) |
| Sivil, Spore Mother | AZ↓ AZ↑ | 9 | 6 body + 1.5 reveal rider + ~8 gated 6-dmg (~0.7 reliability) | **+5…+6.5** | very hot — see §6 |
| Alia, Astral Aligner | AZ↓ AZ↓ | 16 | 7.5 + 3–6 Doom (Constellation 2–4 × 1.5) | −2.5…−5.5 | cold, deep ritual; anti-synergy — see §6 |

Two corrections from the first pass: **Grand Conjuncture** (modal pricing takes the strong mode — draw 2 alone is 8) and **Sivil** (the reveal makes her gate fire ~70%+, and 6 damage to a front-row unit is destroy-any-grade removal, not a half-price rider). The set's honest shape: five cards in the fair band, three hot, three cold, with Sivil far past the legendary allowance. Retunes in §6.

## 5. Design notes

- **The dawn arc.** Dawn Star and Ladybug are at their best in the opening rounds (the loom *is* Constellation 4/3 before anyone weaves) and decay unless you hold the sky together. That's the colour's signature tempo: pay now, maintain later.
- **Weave is development.** Crimson develops by stockpiling excite, Verdant by growing Threadlings; Azure develops by rotating — Mothling, Animater, Strategist and Conjuncture all convert bodies/actions into rotations, marching toward ↓ costs *and* re-stacking groups with the same effect.
- **Cross-colour synergies.** Verdant Threadlings point up by default — they pad Constellations for free and grow the total past 4; a Verdant splash is the obvious second colour. Crimson's Unleash gates want specific orientations — Azure's extra weaves set them up on demand.
- **Alia's self-tension is the feature.** Her own cost points both azure threads down, splitting a 2+2 loom into 2+2 groups — Constellation 2 on arrival. Naked, her Doom is a 2–3 damage afterthought; fed by Threadlings or a re-aligned sky, it's a finisher. She's either unplayable or build-around with nothing between — deliberate or not, it's worth a playtest.

## 6. Open quirks in the published sheet

Hot side (retune these):

1. **Sivil runs +5…+6.5 hot as written** — the reveal rider makes Constellation 4 fire ~70%+ of the time (two matching threads + a typical 2-arrow reveal = 4), and 6 damage to a front-row unit kills nearly everything printed. Retune: 4 damage, *and/or* the gate counts only your loom's threads (reveal then just smooths variance).
2. **Grand Conjuncture runs +1.5…+2 hot** — the draw-2 mode alone is worth 8 on a 5-budget cost (the ← ← heavy-spell tier prices draw 2 at 8 — amber.md §2). Cleanest fix: move it to **AZ← AZ←** (8), which is amber's heavy-spell lane anyway.
3. **Astral Scribe runs +2 hot** — "whenever you play a unit, Chart 1" compounds with every unit played (§3.1 repeatable-trigger rule; third unit takes it to +3). Either accept it as the set's engine or gate to once per round.

Cold side (buff these):

4. **Alia runs −2.5…−5.5 cold** — her own ↓ ↓ cost splits the loom into 2+2 groups, so her Constellation-scaled Doom lands at 2–3 without Threadling support, and the ritual discount (−0.5) doesn't cover the gap. Also: rarity is `common` where every precedent (Riri, Sivil, this card's profile) says legendary.
5. **Astral Ladybug runs −1.5 cold** — a conditional 2/3 for a full AZ→ arrow; either make the gate Constellation 2 (dawn-on) or the body 1/3.
6. **Astral Animater runs −1…−1.5 cold** — the −UP, UP (two-arrow) payment buys one 1.5-amber Weave, an inverted exchange rate (two arrows of payment for one rotation's worth of value). Single-arrow gate (`−UP →`) fixes it.

Cosmetic:

7. **`Sporic Animater`, `Sporic Strategist`, `Sivil, Spore Mother`** — names carried over from the Verdant template rows. This doc calls them Astral Animater/Strategist (§2); Sivil collides outright with Verdant's legendary (rename suggestion: *Vesper, Astral Oracle* or *Lyra, Astral Mother*).
8. **`Quick`** on Dawn Star vs the keyword **Quickstride** everywhere else — normalize.
9. **`Grand Conjuncture`** — likely intended "Conjunction"; harmless either way, just pick one.
10. **`-1/-1 this turn` (Starstruck)** — first temporary duration in the effect vocabulary; needs the usual by-hand tracking (a counter or memory), same as "this round" buffs.
11. **Counter (The Stars Align)** — new effect vocabulary for the game, not just the colour; worth a line in game-design.md §6 once it survives playtest.
