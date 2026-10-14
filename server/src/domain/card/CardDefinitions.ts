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
  extra: { text?: string; rarity?: string } = {},
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

export const FALLBACK_CATALOG: readonly CardDefinition[] = [
  // -------------------------------------------------------------- Verdant
  u("sapling_warden", "Sapling Warden", "verdant", "verdant:up", 1, 3, { rarity: "common" }),
  u("wildwood_elk", "Wildwood Elk", "verdant", "verdant:up verdant:up any:up", 2, 2, { text: "Costs two verdant threads woven Up plus any one thread woven Up.", rarity: "common" }),
  u("grovekeeper", "Grovekeeper", "verdant", "verdant:right verdant:up", 2, 3, { onPlay: [{ kind: "heal_face", amount: 3 }], text: "When woven: gain 3 life. Costs verdant threads woven Up and Right.", rarity: "uncommon" }),
  u("thornhide_behemoth", "Thornhide Behemoth", "verdant", "verdant:right verdant:up any:up", 3, 5, { text: "Costs verdant threads woven Up and Right, plus any thread woven Up.", rarity: "common" }),
  u("ancient_treant", "Ancient Treant", "verdant", "verdant:up verdant:down any:up any:up", 6, 7, { text: "The whole loom, one verdant woven down.", rarity: "rare" }),
  s("wildbloom", "Wildbloom", "verdant", "verdant:up", [{ kind: "heal_face", amount: 4 }], { text: "Gain 4 life.", rarity: "common" }),
  s("natures_bounty", "Nature's Bounty", "verdant", "verdant:left verdant:up", [{ kind: "draw", amount: 1 }, { kind: "heal_face", amount: 2 }], { text: "Draw a card and gain 2 life. Costs verdant threads woven Up and Left.", rarity: "common" }),
  s("deep_roots", "Deep Roots", "verdant", "verdant:left", [{ kind: "buff_unit", atk: 3, hp: 3, scope: "friendly" }], {
    text: "A friendly unit gains +3/+3. Costs a verdant thread woven Left.",
    rarity: "uncommon",
  }),
  s("titangrowth", "Titangrowth", "verdant", "verdant:left verdant:left", [{ kind: "buff_unit", atk: 4, hp: 4, scope: "friendly" }, { kind: "heal_face", amount: 4 }], { text: "A friendly unit gains +4/+4 and you gain 4 life. Costs two verdant threads woven Left.", rarity: "rare" }),

  // -------------------------------------------------------------- Neutral
  u("wandering_apprentice", "Wandering Apprentice", "neutral", "any:up", 1, 1, { rarity: "common" }),
  u("roadwarden", "Roadwarden", "neutral", "any:right any:up", 2, 2, { text: "Costs any threads woven Right and Up — weave any thread right to unlock it.", rarity: "common" }),
  u("mercenary_captain", "Mercenary Captain", "neutral", "any:right any:right any:up", 3, 3, { text: "Costs two threads woven Right plus any thread woven Up.", rarity: "uncommon" }),
  s("wanderers_map", "Wanderer's Map", "neutral", "any:left any:left", [{ kind: "draw", amount: 1 }], { text: "Draw a card. Costs any two threads woven Left.", rarity: "common" }),
  s("flash_of_steel", "Flash of Steel", "neutral", "any:up", [{ kind: "buff_unit", atk: 1, hp: 0, scope: "friendly" }], { text: "A friendly unit gains +1 power.", rarity: "common" }),
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
      text: def.text ?? "",
      rarity: def.rarity ?? "common",
    },
  );
}
