/**
 * Card catalog: definitions + built-in fallback list.
 * Definitions can be replaced at startup from CSVs (see infrastructure/cards/csvCatalog.ts);
 * the built-in list below guarantees a playable game with zero configuration.
 *
 * Costs are coloured orientations: a card costing [ember:up, ember:left] is paid by
 * exhausting two ember threads, one pointing up and one pointing left. The colour
 * "any" matches a thread of any colour (used by neutral cards and heavy costs).
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
 * whitespace, "+" or ","; each entry is "colour:orientation" ("ember:up",
 * "any:down"), with prefix matching on both sides ("e:u", "t:l"). A bare
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
      : (["any", "neutral", "ember", "tide", "verdant", "umbra"] as const).find((c) => c.startsWith(colourRaw));
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
  // ---------------------------------------------------------------- Ember
  u("cinder_whelp", "Cinder Whelp", "ember", "ember:up", 2, 1, { haste: true, text: "Quickstride — can attack the round it is woven.", rarity: "common" }),
  u("ember_skirmisher", "Ember Skirmisher", "ember", "ember:up ember:up", 3, 2, { rarity: "common" }),
  u("warpath_howler", "Warpath Howler", "ember", "ember:up ember:up", 2, 2, { haste: true, text: "Quickstride — can attack the round it is woven.", rarity: "uncommon" }),
  u("ashblade_berserker", "Ashblade Berserker", "ember", "ember:up ember:up any:up", 4, 3, { text: "Costs two ember threads woven Up plus any one thread woven Up.", rarity: "common" }),
  u("flamecaller_djinn", "Flamecaller Djinn", "ember", "ember:up ember:right any:up", 5, 3, { text: "Costs ember threads woven Up and Right, plus any thread woven Up — weave ahead to unlock it.", rarity: "rare" }),
  u("pyre_colossus", "Pyre Colossus", "ember", "ember:up ember:down any:up any:up", 6, 6, { text: "Costs ember threads woven Up and Down, plus any two threads woven Up.", rarity: "rare" }),
  s("scorch", "Scorch", "ember", "ember:up", [{ kind: "damage_unit", amount: 2, scope: "any" }], { text: "Deal 2 damage to any unit.", rarity: "common" }),
  s("immolate", "Immolate", "ember", "ember:up ember:up", [{ kind: "damage_unit", amount: 3, scope: "any" }], { text: "Deal 3 damage to any unit.", rarity: "common" }),
  s("blazing_rush", "Blazing Rush", "ember", "ember:up", [{ kind: "buff_unit", atk: 2, hp: 0, scope: "friendly" }], { text: "A friendly unit gains +2 power.", rarity: "common" }),
  s("ember_volley", "Ember Volley", "ember", "ember:up ember:up any:up", [{ kind: "damage_face", amount: 4 }], { text: "Deal 4 damage to the enemy weaver.", rarity: "uncommon" }),

  // ----------------------------------------------------------------- Tide
  u("tidepool_scout", "Tidepool Scout", "tide", "tide:up", 1, 2, { rarity: "common" }),
  u("mistward_sentinel", "Mistward Sentinel", "tide", "tide:up tide:up", 2, 4, { rarity: "common" }),
  u("riptide_adept", "Riptide Adept", "tide", "tide:up tide:up", 2, 2, { onPlay: [{ kind: "draw", amount: 1 }], text: "When woven: draw a card.", rarity: "uncommon" }),
  u("deepwater_leviathan", "Deepwater Leviathan", "tide", "tide:up tide:down any:up any:up", 5, 6, { text: "Costs tide threads woven Up and Down, plus any two threads woven Up.", rarity: "rare" }),
  s("undertow", "Undertow", "tide", "tide:up tide:up", [{ kind: "return_to_hand", scope: "enemy" }], { text: "Return an enemy unit to its owner's hand.", rarity: "uncommon" }),
  s("tidal_insight", "Tidal Insight", "tide", "tide:up tide:up", [{ kind: "draw", amount: 2 }], { text: "Draw 2 cards.", rarity: "common" }),
  s("still_waters", "Still Waters", "tide", "tide:up", [{ kind: "ready_thread" }], { text: "Ready (un-exhaust) one of your exhausted threads.", rarity: "uncommon" }),
  s("moonlit_current", "Moonlit Current", "tide", "tide:up tide:left", [{ kind: "rotate_thread" }, { kind: "draw", amount: 1 }], {
    text: "Rotate one of your threads 90° in any direction, then draw a card. Costs tide threads woven Up and Left.",
    rarity: "rare",
  }),

  // -------------------------------------------------------------- Verdant
  u("sapling_warden", "Sapling Warden", "verdant", "verdant:up", 1, 3, { rarity: "common" }),
  u("grovekeeper", "Grovekeeper", "verdant", "verdant:up verdant:up", 2, 3, { onPlay: [{ kind: "heal_face", amount: 3 }], text: "When woven: gain 3 life.", rarity: "common" }),
  u("thornhide_behemoth", "Thornhide Behemoth", "verdant", "verdant:up verdant:up any:up", 4, 5, { text: "Costs two verdant threads woven Up plus any one thread woven Up.", rarity: "common" }),
  u("ancient_treant", "Ancient Treant", "verdant", "verdant:up verdant:down any:up any:up", 6, 7, { text: "Costs verdant threads woven Up and Down, plus any two threads woven Up.", rarity: "rare" }),
  s("wildbloom", "Wildbloom", "verdant", "verdant:up", [{ kind: "heal_face", amount: 4 }], { text: "Gain 4 life.", rarity: "common" }),
  s("natures_bounty", "Nature's Bounty", "verdant", "verdant:up verdant:up", [{ kind: "draw", amount: 1 }, { kind: "heal_face", amount: 2 }], { text: "Draw a card and gain 2 life.", rarity: "common" }),
  s("deep_roots", "Deep Roots", "verdant", "verdant:up verdant:down", [{ kind: "buff_unit", atk: 2, hp: 2, scope: "friendly" }], {
    text: "A friendly unit gains +2/+2. Costs verdant threads woven Up and Down.",
    rarity: "uncommon",
  }),

  // ---------------------------------------------------------------- Umbra
  u("shadewisp", "Shadewisp", "umbra", "umbra:up", 2, 1, { rarity: "common" }),
  u("nightprowler", "Nightprowler", "umbra", "umbra:up umbra:up", 2, 2, { haste: true, text: "Quickstride — can attack the round it is woven.", rarity: "uncommon" }),
  u("duskfang_stalker", "Duskfang Stalker", "umbra", "umbra:up umbra:up any:up", 4, 2, { text: "Costs two umbra threads woven Up plus any one thread woven Up.", rarity: "common" }),
  u("voidcaller", "Voidcaller", "umbra", "umbra:up umbra:left any:up", 3, 4, { text: "Costs umbra threads woven Up and Left, plus any thread woven Up — weave ahead to unlock it.", rarity: "uncommon" }),
  u("night_reaper", "Night Reaper", "umbra", "umbra:up umbra:down any:up any:up", 5, 5, { text: "Costs umbra threads woven Up and Down, plus any two threads woven Up.", rarity: "rare" }),
  s("silencers_blade", "Silencer's Blade", "umbra", "umbra:up umbra:up", [{ kind: "destroy_unit", maxPower: 3, scope: "enemy" }], { text: "Destroy an enemy unit with 3 or less power.", rarity: "uncommon" }),
  s("soul_fracture", "Soul Fracture", "umbra", "umbra:up umbra:up", [{ kind: "purge_deck_top", amount: 2 }], { text: "The enemy weaver purges the top 2 cards of their deck.", rarity: "rare" }),
  s("wraiths_grasp", "Wraith's Grasp", "umbra", "umbra:up", [{ kind: "buff_unit", atk: 0, hp: -2, scope: "enemy" }], { text: "An enemy unit gets -0/-2. It unravels if its health reaches 0.", rarity: "common" }),

  // -------------------------------------------------------------- Neutral
  u("wandering_apprentice", "Wandering Apprentice", "neutral", "any:up", 1, 1, { rarity: "common" }),
  u("roadwarden", "Roadwarden", "neutral", "any:up any:up", 2, 2, { rarity: "common" }),
  u("mercenary_captain", "Mercenary Captain", "neutral", "any:up any:up any:up", 3, 3, { rarity: "common" }),
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
