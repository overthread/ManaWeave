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
    name: "Verdant Growth",
    loom: ["verdant", "verdant", "azure", "crimson"],
    cards: {
      sapling_warden: 3,
      wildwood_elk: 3,
      grovekeeper: 3,
      thornhide_behemoth: 2,
      ancient_treant: 2,
      wildbloom: 3,
      natures_bounty: 2,
      deep_roots: 1,
      wandering_apprentice: 1,
    },
  },
  {
    name: "Verdant Bulwark",
    loom: ["verdant", "verdant", "verdant", "verdant"],
    cards: {
      sapling_warden: 3,
      wildwood_elk: 2,
      grovekeeper: 2,
      thornhide_behemoth: 3,
      ancient_treant: 2,
      wildbloom: 3,
      titangrowth: 2,
      roadwarden: 2,
      wanderers_map: 1,
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
