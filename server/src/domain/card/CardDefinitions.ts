/**
 * Card catalog: definitions + built-in fallback list.
 * Definitions can be replaced at startup from CSVs (see infrastructure/cards/csvCatalog.ts);
 * the built-in list below guarantees a playable game with zero configuration.
 *
 * Costs are coloured orientations: a card costing [ember:up, ember:left] is paid by
 * exhausting two ember threads, one pointing up and one pointing left. The colour
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
      : (["any", "neutral", "ember", "tide", "verdant", "umbra", "crimson", "azure"] as const).find((c) => c.startsWith(colourRaw));
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
  u("cinder_whelp", "Cinder Whelp", "ember", "ember:up", 1, 1, { haste: true, text: "Quickstride — can attack the round it is woven.", rarity: "common" }),
  u("ember_skirmisher", "Ember Skirmisher", "ember", "ember:up ember:up", 2, 2, { rarity: "common" }),
  u("ashblade_berserker", "Ashblade Berserker", "ember", "ember:up ember:up any:up", 3, 1, { text: "Costs two ember threads woven Up plus any one thread woven Up.", rarity: "common" }),
  u("warpath_howler", "Warpath Howler", "ember", "ember:right ember:up any:up", 3, 3, { haste: true, text: "Quickstride — can attack the round it is woven. Costs ember threads woven Up and Right, plus any thread woven Up.", rarity: "uncommon" }),
  u("flamecaller_djinn", "Flamecaller Djinn", "ember", "ember:up ember:right any:up", 4, 3, { text: "Costs ember threads woven Up and Right, plus any thread woven Up — weave ahead to unlock it.", rarity: "rare" }),
  u("pyre_colossus", "Pyre Colossus", "ember", "ember:up ember:down any:up any:up", 7, 6, { text: "The whole loom, one ember woven down.", rarity: "rare" }),
  s("scorch", "Scorch", "ember", "ember:up", [{ kind: "damage_unit", amount: 1, scope: "any" }], { text: "Deal 1 damage to any unit.", rarity: "common" }),
  s("blazing_rush", "Blazing Rush", "ember", "ember:up", [{ kind: "buff_unit", atk: 2, hp: 0, scope: "friendly" }], { text: "A friendly unit gains +2 power.", rarity: "common" }),
  s("immolate", "Immolate", "ember", "ember:left ember:left", [{ kind: "damage_unit", amount: 4, scope: "any" }], { text: "Deal 4 damage to any unit. Costs two ember threads woven Left.", rarity: "common" }),
  s("ember_volley", "Ember Volley", "ember", "ember:left ember:left any:up", [{ kind: "damage_face", amount: 5 }], { text: "Deal 5 damage to the enemy weaver. Costs two ember threads woven Left plus any thread woven Up.", rarity: "uncommon" }),

  // ----------------------------------------------------------------- Tide
  u("tidepool_scout", "Tidepool Scout", "tide", "tide:up", 1, 2, { rarity: "common" }),
  u("reefback_turtle", "Reefback Turtle", "tide", "tide:up tide:up", 1, 3, { rarity: "common" }),
  u("riptide_adept", "Riptide Adept", "tide", "tide:right tide:up", 1, 1, { onPlay: [{ kind: "draw", amount: 1 }], text: "When woven: draw a card. Costs tide threads woven Up and Right.", rarity: "uncommon" }),
  u("mistward_sentinel", "Mistward Sentinel", "tide", "tide:right tide:up", 3, 4, { text: "Costs tide threads woven Up and Right — weave a tide thread right during an early round to unlock it.", rarity: "common" }),
  u("deepwater_leviathan", "Deepwater Leviathan", "tide", "tide:down tide:up", 6, 6, { text: "Costs tide threads woven Up and Down — weave a tide thread down (two rotations) to unlock it.", rarity: "rare" }),
  s("still_waters", "Still Waters", "tide", "tide:up", [{ kind: "ready_thread" }], { text: "Ready (un-exhaust) one of your exhausted threads.", rarity: "common" }),
  s("tidal_insight", "Tidal Insight", "tide", "tide:left tide:left", [{ kind: "draw", amount: 2 }], { text: "Draw 2 cards. Costs two tide threads woven Left.", rarity: "common" }),
  s("moonlit_current", "Moonlit Current", "tide", "tide:left tide:up", [{ kind: "rotate_thread" }, { kind: "draw", amount: 1 }], {
    text: "Rotate one of your threads 90° in any direction, then draw a card. Costs tide threads woven Up and Left.",
    rarity: "uncommon",
  }),
  s("undertow", "Undertow", "tide", "tide:left", [{ kind: "return_to_hand", scope: "enemy" }], { text: "Return an enemy unit to its owner's hand. Costs a tide thread woven Left.", rarity: "uncommon" }),
  s("abyssal_insight", "Abyssal Insight", "tide", "tide:down tide:left", [{ kind: "draw", amount: 3 }], { text: "Draw 3 cards. Costs tide threads woven Down and Left.", rarity: "rare" }),

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

  // ---------------------------------------------------------------- Umbra
  u("shadewisp", "Shadewisp", "umbra", "umbra:up", 2, 1, { rarity: "common" }),
  u("nightprowler", "Nightprowler", "umbra", "umbra:right umbra:up any:up", 3, 2, { haste: true, text: "Quickstride — can attack the round it is woven. Costs umbra threads woven Up and Right, plus any thread woven Up.", rarity: "uncommon" }),
  u("duskfang_stalker", "Duskfang Stalker", "umbra", "umbra:right umbra:up", 4, 2, { text: "Costs umbra threads woven Up and Right — weave ahead to unlock it.", rarity: "common" }),
  u("voidcaller", "Voidcaller", "umbra", "umbra:right umbra:up any:up", 3, 3, { onPlay: [{ kind: "purge_deck_top", amount: 1 }], text: "When woven: the enemy weaver purges the top card of their deck. Costs umbra threads woven Up and Right, plus any thread woven Up.", rarity: "uncommon" }),
  u("night_reaper", "Night Reaper", "umbra", "umbra:down umbra:up", 6, 6, { text: "Costs umbra threads woven Up and Down — weave an umbra thread down (two rotations) to unlock it.", rarity: "rare" }),
  s("wraiths_grasp", "Wraith's Grasp", "umbra", "umbra:up", [{ kind: "buff_unit", atk: -1, hp: -2, scope: "enemy" }], { text: "An enemy unit gets −1/−2. It unravels if its health reaches 0.", rarity: "common" }),
  s("silencers_blade", "Silencer's Blade", "umbra", "umbra:left umbra:up", [{ kind: "destroy_unit", maxPower: 3, scope: "enemy" }], { text: "Destroy an enemy unit with 3 or less power. Costs umbra threads woven Left and Up.", rarity: "uncommon" }),
  s("soul_fracture", "Soul Fracture", "umbra", "umbra:left", [{ kind: "purge_deck_top", amount: 4 }], { text: "The enemy weaver purges the top 4 cards of their deck. Costs an umbra thread woven Left.", rarity: "rare" }),
  s("devouring_dark", "Devouring Dark", "umbra", "umbra:left umbra:left", [{ kind: "destroy_unit", maxPower: 99, scope: "enemy" }], { text: "Destroy an enemy unit. Costs two umbra threads woven Left.", rarity: "rare" }),

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
