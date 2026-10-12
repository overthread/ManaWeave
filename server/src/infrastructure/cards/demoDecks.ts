/**
 * Balanced demo decks for direct game creation (POST /api/games with no decks)
 * and as "sample pattern" templates in the deck builder.
 */

import { createCardFromDefinition } from "../../domain/card/CardDefinitions.js";
import type { Card, ThreadColour } from "../../domain/card/Card.js";

export interface DemoDeckTemplate {
  name: string;
  loom: ThreadColour[];
  cards: Record<string, number>;
}

export const DEMO_DECKS: readonly DemoDeckTemplate[] = [
  {
    name: "Ember/Umbra Assault",
    loom: ["ember", "ember", "umbra", "umbra"],
    cards: {
      cinder_whelp: 3,
      warpath_howler: 2,
      ember_skirmisher: 3,
      ashblade_berserker: 3,
      scorch: 3,
      shadewisp: 3,
      nightprowler: 2,
      blazing_rush: 1,
    },
  },
  {
    name: "Tide/Verdant Bulwark",
    loom: ["tide", "tide", "verdant", "verdant"],
    cards: {
      tidepool_scout: 3,
      mistward_sentinel: 3,
      riptide_adept: 2,
      sapling_warden: 3,
      grovekeeper: 3,
      thornhide_behemoth: 2,
      tidal_insight: 2,
      wildbloom: 2,
    },
  },
];

export function expandTemplate(template: DemoDeckTemplate): Card[] {
  const cards: Card[] = [];
  for (const [cardDefId, quantity] of Object.entries(template.cards)) {
    for (let i = 0; i < quantity; i++) cards.push(createCardFromDefinition(cardDefId, cardDefId));
  }
  return cards;
}

export function buildDemoPlayerDecks(): { decks: Record<string, Card[]>; looms: Record<string, ThreadColour[]>; names: Record<string, string> } {
  const [a, b] = DEMO_DECKS;
  return {
    decks: { p1: expandTemplate(a!), p2: expandTemplate(b!) },
    looms: { p1: [...a!.loom], p2: [...b!.loom] },
    names: { p1: "Demo Weaver A", p2: "Demo Weaver B" },
  };
}
