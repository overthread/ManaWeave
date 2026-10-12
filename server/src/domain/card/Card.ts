/**
 * ManaWeave card instance + effect vocabulary.
 * The server ruleset is the only consumer of `effects`; clients render `metadata.text`.
 */

export type CardType = "unit" | "spell";

export type ThreadColour = "ember" | "tide" | "verdant" | "umbra" | "neutral";

/** The four directions a thread can point; a card's cost is a list of these. */
export type OrientationName = "up" | "right" | "down" | "left";

export const ORIENTATIONS: readonly OrientationName[] = ["up", "right", "down", "left"];

/** Colour of one cost entry; "any" matches a thread of any colour. */
export type CostColour = ThreadColour | "any";

/**
 * One entry of a card's cost: exhaust a thread of this colour pointing this way.
 */
export interface CostEntry {
  readonly colour: CostColour;
  readonly orientation: OrientationName;
}

export type EffectKind =
  | "damage_unit" // deal {amount} damage to a chosen unit (scope filters candidates)
  | "damage_face" // deal {amount} damage to the enemy player
  | "heal_face" // gain {amount} life
  | "buff_unit" // chosen unit gains +atk/+hp (signed; negative hp = debuff)
  | "draw" // draw {amount} cards
  | "ready_thread" // un-exhaust one of your exhausted threads
  | "rotate_thread" // rotate one of your threads 90° (chosen direction)
  | "return_to_hand" // return a chosen enemy unit to its owner's hand
  | "destroy_unit" // destroy a chosen enemy unit with power <= {maxPower}
  | "purge_deck_top"; // enemy purges {amount} cards from the top of their deck

export interface CardEffect {
  readonly kind: EffectKind;
  readonly amount?: number;
  readonly atk?: number;
  readonly hp?: number;
  readonly maxPower?: number;
  readonly scope?: "any" | "enemy" | "friendly";
}

export interface CardStats {
  attack: number;
  health: number;
  /** Orientation cost: exhaust one ready thread per entry, matching colour and direction. */
  cost: readonly CostEntry[];
}

export class Card {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: CardType,
    public readonly stats: CardStats,
    public readonly effects: readonly CardEffect[] = [],
    public readonly metadata: Record<string, unknown> = {},
  ) {}

  clone(): Card {
    return new Card(
      this.id,
      this.name,
      this.type,
      { ...this.stats },
      this.effects.map((e) => ({ ...e })),
      { ...this.metadata },
    );
  }
}
