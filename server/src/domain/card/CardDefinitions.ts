/**
 * Card catalog: definitions + built-in fallback list.
 * Definitions can be replaced at startup from CSVs (see infrastructure/cards/csvCatalog.ts);
 * the built-in list below guarantees a playable game with zero configuration.
 *
 * Costs are coloured orientations: a card costing [crimson:up, crimson:left] is paid by
 * exhausting two crimson threads, one pointing up and one pointing left. The colour
 * "any" matches a thread of any colour (used by neutral cards and heavy costs).
 *
 * The list is costed against the amber economy (docs/amber.md): each arrow grants a
 * budget (up 1, left 4, right 4, down 8; grey arrows half), stats and effects carry
 * amber prices (power 1, health 0.5, damage 2, draw 4). Cost lanes: up = early units
 * and cheap tricks, right = mid-game units, left = spells, down = greater effects.
 */

import { Card, type CardEffect, type CardType, type CostEntry, type ThreadColour } from "./Card.js";

export interface CardDefinition {
  readonly id: string;
  readonly title: string;
  readonly type: CardType;
  readonly colour: ThreadColour;
  readonly cost: readonly CostEntry[];
  readonly attack: number;
  readonly health: number;
  readonly haste?: boolean;
  readonly effects?: readonly CardEffect[];
  readonly onPlay?: readonly CardEffect[];
  /** Reaction: the spell may be cast outside your own round (it joins the shared spell stack). */
  readonly reaction?: boolean;
  readonly text?: string;
  readonly rarity?: string;
  readonly category: string;
}

/**
 * Parse a compact cost string for the built-in catalog. Entries are separated by
 * whitespace, "+" or ","; each entry is "colour:orientation" ("crimson:up",
 * "any:down"), with prefix matching on both sides ("c:u", "az:l"). A bare
 * orientation token ("up") means any colour.
 */
export function parseCost(raw: string): CostEntry[] {
  const out: CostEntry[] = [];
  for (const token of raw.toLowerCase().split(/[^a-z:]+/).filter(Boolean)) {
    const parts = token.split(":");
    const colourRaw = parts.length >= 2 ? parts[0] : undefined;
    const orientationRaw = parts.length >= 2 ? parts[1]! : parts[0]!;
    const orientation = (["up", "right", "down", "left"] as const).find((o) => o.startsWith(orientationRaw));
    if (!orientation) throw new Error(`Unknown orientation in cost entry: "${token}" (in "${raw}")`);
    const colour = colourRaw === undefined
      ? "any"
      : (["any", "neutral", "crimson", "azure", "verdant"] as const).find((c) => c.startsWith(colourRaw));
    if (!colour) throw new Error(`Unknown colour in cost entry: "${token}" (in "${raw}")`);
    out.push({ colour: colour === "neutral" ? "any" : colour, orientation });
  }
  return out;
}

const u = (
  id: string,
  title: string,
  colour: ThreadColour,
  cost: string,
  attack: number,
  health: number,
  extra: { haste?: boolean; onPlay?: readonly CardEffect[]; text?: string; rarity?: string } = {},
): CardDefinition => ({
  id,
  title,
  type: "unit",
  colour,
  cost: parseCost(cost),
  attack,
  health,
  category: "units",
  ...extra,
});

const s = (
  id: string,
  title: string,
  colour: ThreadColour,
  cost: string,
  effects: readonly CardEffect[],
  extra: { text?: string; rarity?: string; reaction?: boolean } = {},
): CardDefinition => ({
  id,
  title,
  type: "spell",
  colour,
  cost: parseCost(cost),
  attack: 0,
  health: 0,
  effects,
  category: "spells",
  ...extra,
});

/**
 * Built-in catalog — a faithful transcription of the three published colour
 * sheets (docs/game-design.md §9): 12 Crimson (Riff — excite/unleash), 12
 * Verdant (Sporic — Threadling/animate) and 12 Azure (Astral — constellation)
 * cards, same ids the CSV loader slugifies, so a configured CARD_CSV_URL and
 * the zero-config fallback produce the same game. Card text is the sheets'
 * prose `effect` column, resolved by hand (§6.1).
 */
export const FALLBACK_CATALOG: readonly CardDefinition[] = [
  // -------------------------------------------------------------- Crimson
  u("riff_larva", "Riff Larva", "crimson", "crimson:up crimson:up", 1, 1, { text: "Doom: Excite.", rarity: "common" }),
  u("riff_eater", "Riff Eater", "crimson", "crimson:up crimson:up", 2, 1, { text: "Played: Discard 1 -> Excite.", rarity: "common" }),
  u("riff_aggressor", "Riff Aggressor", "crimson", "crimson:up crimson:up crimson:up", 4, 1, { text: "Played: Your opponents draw 1. Unleash DOWN to not.", rarity: "uncommon" }),
  u("riff_crawler", "Riff Crawler", "crimson", "crimson:right", 1, 1, { text: "Played: Unleash DOWN -> Draw 1.", rarity: "common" }),
  u("riff_shrieker", "Riff Shrieker", "crimson", "crimson:right crimson:up", 2, 2, { text: "Played: Unleash UP -> Gain +2/+2.", rarity: "common" }),
  u("riff_hunter", "Riff Hunter", "crimson", "crimson:right crimson:right", 3, 3, { text: "Hunt. Kill: Excite.", rarity: "uncommon" }),
  s("wyrmbite", "Wyrmbite", "crimson", "crimson:left", [], { text: "Reaction. Played: Deal 2 damage to any front-row unit. Unleash LEFT to draw 1.", rarity: "common", reaction: true }),
  s("hunting_extincts", "Hunting Extincts", "crimson", "crimson:left", [], { text: "Played: Grant a friendly unit Hunt and +1/+0 this round. Excite.", rarity: "uncommon" }),
  s("enrage", "Enrage", "crimson", "crimson:left crimson:up", [], { text: "Reaction. Played: Give a unit +2/+1 this round. Unleash LEFT to draw 1.", rarity: "common", reaction: true }),
  s("encore", "Encore", "crimson", "crimson:left crimson:up", [], { text: "Played: Draw 1, Excite. Unleash LEFT -> Draw 1.", rarity: "common" }),
  u("riri_riff_star", "Riri, Riff Star", "crimson", "crimson:down crimson:up", 3, 5, { text: "The first time you unleash each turn, deal 2 damage to the enemy champion.", rarity: "legendary" }),
  u("reil_riff_devourer", "Reil, Riff Devourer", "crimson", "crimson:down crimson:up crimson:up", 5, 4, { text: "Kill: Excite and Draw 1.", rarity: "uncommon" }),

  // -------------------------------------------------------------- Verdant
  u("sporic_sapling", "Sporic Sapling", "verdant", "verdant:up verdant:up", 1, 1, { text: "Doom: Sprout.", rarity: "common" }),
  u("sporic_agent", "Sporic Agent", "verdant", "verdant:up verdant:up", 1, 1, { text: "If you have another unit in this lane, this has +1/+1.", rarity: "common" }),
  u("sporic_arouser", "Sporic Arouser", "verdant", "verdant:up verdant:up verdant:up", 2, 1, { text: "Your front-row units here has +1/+0.", rarity: "common" }),
  u("sporic_trader", "Sporic Trader", "verdant", "verdant:right", 2, 2, { text: "Played: Sprout.", rarity: "uncommon" }),
  u("sporic_animater", "Sporic Animater", "verdant", "verdant:right verdant:up", 2, 2, { text: "Doom: Sprout, then Animate.", rarity: "common" }),
  u("sporic_strategist", "Sporic Strategist", "verdant", "verdant:right verdant:right", 3, 3, { text: "Ability: Sacrifice a friendly unit, -UP -> Draw 1.", rarity: "uncommon" }),
  s("guards", "Guards!", "verdant", "verdant:left", [], { text: "Reaction. Played: Animate, give it +2/+0 this round.", rarity: "common", reaction: true }),
  s("together_strong", "Together Strong", "verdant", "verdant:left", [], { text: "Played: Choose a unit, give it +1/+1 this round for each front-row unit you have.", rarity: "uncommon" }),
  s("bonds_of_strength", "Bonds of Strength", "verdant", "verdant:left verdant:up", [], { text: "Reaction. Played: Give all your front-row units +2/+0 this round.", rarity: "common", reaction: true }),
  s("sacrifice", "Sacrifice", "verdant", "verdant:left verdant:up", [], { text: "Played: All players must sacrifice a unit if possible.", rarity: "common" }),
  u("sire_sporic_commander", "Sire, Sporic Commander", "verdant", "verdant:down verdant:up", 3, 3, { text: "Your front row units have +1/+1.", rarity: "uncommon" }),
  u("sivil_spore_mother", "Sivil, Spore Mother", "verdant", "verdant:down verdant:up verdant:up", 4, 4, { text: "The first time you Animate each turn, this gains +1/+1.", rarity: "legendary" }),

  // ---------------------------------------------------------------- Azure
  u("dawn_star", "Dawn Star", "azure", "azure:up azure:up", 1, 1, { text: "Played: Constellation 4 - This can attack immediately.", rarity: "common" }),
  u("astral_mothling", "Astral Mothling", "azure", "azure:up azure:up", 1, 1, { text: "Doom: Weave.", rarity: "common" }),
  u("astral_scribe", "Astral Scribe", "azure", "azure:up azure:up azure:up", 2, 1, { text: "Whenever you play a unit, Chart 1.", rarity: "common" }),
  u("astral_ladybug", "Astral Ladybug", "azure", "azure:right", 1, 2, { text: "Constellation 3 - This has +1/+1.", rarity: "uncommon" }),
  u("astral_weaver", "Astral Weaver", "azure", "azure:right azure:up", 2, 2, { text: "Ability: -UP, UP -> Weave.", rarity: "uncommon" }),
  u("astral_serratist", "Astral Serratist", "azure", "azure:right azure:right", 3, 3, { text: "Kill: Weave", rarity: "uncommon" }),
  s("starstruck", "Starstruck", "azure", "azure:left", [], { text: "Reaction. Played: Choose a unit, give it -1/-1 this turn.\nConstellation 3 - Chart 2.", rarity: "common", reaction: true }),
  s("starfall", "Starfall", "azure", "azure:left azure:up", [], { text: "Played: Deal 2 damage to any front-row unit.\nConstellation 3 - You may repeat this effect.", rarity: "uncommon" }),
  s("grand_conjuncture", "Grand Conjuncture", "azure", "azure:left azure:up", [], { text: "Played: Weave twice or Draw 2.", rarity: "common" }),
  s("the_stars_align", "The Stars Align", "azure", "azure:left azure:left", [], { text: "Reaction. Counter target spell.\nConstellation 3 - Chart 2.", rarity: "uncommon", reaction: true }),
  u("alia_astral_aligner", "Alia, Astral Aligner", "azure", "azure:down azure:up", 4, 4, { text: "Played: Reveal the top card of your deck, the cost of that card adds to your total Constellation this turn.\nConstellation 4 - Deal 6 damage to any front-row unit.", rarity: "legendary" }),
  u("arsdeth_deathstar", "Arsdeth, Deathstar", "azure", "azure:down azure:down", 5, 5, { text: "Doom: Deal damage equal to your constellation to the enemy Champion.", rarity: "common" }),
];

let definitions: CardDefinition[] = [...FALLBACK_CATALOG];

export function setCardDefinitions(defs: readonly CardDefinition[]): void {
  const seen = new Set<string>();
  const normalized: CardDefinition[] = [];
  for (const d of defs) {
    if (!d || typeof d.id !== "string" || seen.has(d.id)) continue;
    seen.add(d.id);
    normalized.push(d);
  }
  if (normalized.length > 0) definitions = normalized;
}

export function listCardDefinitions(): readonly CardDefinition[] {
  return definitions;
}

export function getCardDefinition(id: string): CardDefinition | undefined {
  return definitions.find((d) => d.id === id);
}

/**
 * Stamp a catalog definition into a card instance. `uniqueId` is assigned by the
 * ruleset at game start; the definition id travels in `metadata.baseCardId`.
 */
export function createCardFromDefinition(cardDefId: string, uniqueId: string): Card {
  const def = getCardDefinition(cardDefId);
  if (!def) throw new Error(`Unknown card definition: ${cardDefId}`);
  const cost = def.cost.map((e) => ({ ...e }));
  return new Card(
    uniqueId,
    def.title,
    def.type,
    { attack: def.attack, health: def.health, cost },
    [...(def.effects ?? [])],
    {
      baseCardId: def.id,
      colour: def.colour,
      cost,
      power: def.attack,
      health: def.health,
      haste: def.haste === true,
      onPlay: [...(def.onPlay ?? [])],
      reaction: def.reaction === true,
      text: def.text ?? "",
      rarity: def.rarity ?? "common",
    },
  );
}
