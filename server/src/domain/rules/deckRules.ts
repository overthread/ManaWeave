/**
 * Deck-building constants shared by the ruleset (game-creation guard) and the
 * HTTP routes (API guard) so the two can never drift.
 */

import type { ThreadColour } from "../card/Card.js";

export const DECK_MIN_SIZE = 20;
export const DECK_MAX_SIZE = 30;
export const MAX_COPIES_PER_CARD = 2;
export const LOOM_SIZE = 4;
/** Loom-pickable thread colours: Crimson, Azure, Verdant. */
export const THREAD_COLOURS: readonly ThreadColour[] = ["crimson", "azure", "verdant"];
export const STARTING_LIFE = 20;
export const STARTING_HAND_SIZE = 4;
export const LANES = 3;
