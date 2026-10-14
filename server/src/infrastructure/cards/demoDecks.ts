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
    // Threadling/animate economy: every Sporic card ×2. Three verdant threads
    // cover the 3-verdant costs (Sporic Arouser, Sivil); the azure thread is
    // spare capacity.
    name: "Sporic Swarm",
    loom: ["verdant", "verdant", "verdant", "azure"],
    cards: {
      sporic_sapling: 2,
      sporic_agent: 2,
      sporic_arouser: 2,
      sporic_trader: 2,
      sporic_animater: 2,
      sporic_strategist: 2,
      guards: 2,
      together_strong: 2,
      bonds_of_strength: 2,
      sacrifice: 2,
      sire_sporic_commander: 2,
      sivil_spore_mother: 2,
    },
  },
  {
    // Excite/unleash economy: every Riff card ×2. Mono-crimson loom feeds the
    // 3-crimson costs (Riff Aggressor, Reil).
    name: "Riff Riot",
    loom: ["crimson", "crimson", "crimson", "crimson"],
    cards: {
      riff_larva: 2,
      riff_eater: 2,
      riff_aggressor: 2,
      riff_crawler: 2,
      riff_shrieker: 2,
      riff_hunter: 2,
      wyrmbite: 2,
      hunting_extincts: 2,
      enrage: 2,
      encore: 2,
      riri_riff_star: 2,
      reil_riff_devourer: 2,
    },
  },
  {
    // Constellation economy: every Astral card ×2. Mono-azure loom feeds the
    // 3-azure cost (Astral Scribe) and the doubled left/down costs (The Stars
    // Align, Arsdeth).
    name: "Astral Alignment",
    loom: ["azure", "azure", "azure", "azure"],
    cards: {
      dawn_star: 2,
      astral_mothling: 2,
      astral_scribe: 2,
      astral_ladybug: 2,
      astral_weaver: 2,
      astral_serratist: 2,
      starstruck: 2,
      starfall: 2,
      grand_conjuncture: 2,
      the_stars_align: 2,
      alia_astral_aligner: 2,
      arsdeth_deathstar: 2,
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
