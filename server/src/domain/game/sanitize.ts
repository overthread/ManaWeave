/**
 * Single place where raw GameState becomes a per-player client view.
 * Own zones in full; opponent zones become counts; looms and battlefield are public.
 */

import type { GameState } from "./GameState.js";
import type { GameAction } from "../actions/GameAction.js";
import type { RuleSet } from "../rules/RuleSet.js";
import type { Card } from "../card/Card.js";
import { parseLooms, parseDeckPeeks, parseSpellStack, parseFlags, parseTargetArrows } from "../rules/LoomRuleSet.js";

export interface PublicCardCostEntry {
  colour: string;
  orientation: string;
}

export interface PublicCardView {
  id: string;
  name: string;
  type: string;
  colour: string;
  /** Cost: exhaust one ready thread per entry, matching colour ("any" = wildcard) and direction. */
  cost: PublicCardCostEntry[];
  power: number;
  health: number;
  haste: boolean;
  /** Reaction: the spell may be cast outside your own round (joins the shared spell stack). */
  reaction?: boolean;
  text: string;
  rarity: string;
  lane?: number;
  row?: string;
  owner?: string;
  attackedThisTurn?: boolean;
  movedThisTurn?: boolean;
}

export interface PublicThreadView {
  id: string;
  colour: string;
  orientation: number;
  exhausted: boolean;
  /** Threadling token thread (colourless; sacrificed to pay any one arrow). */
  token?: boolean;
  /** Excite tokens sitting on this thread, spent by Unleash. */
  excite?: number;
}

export interface PublicPlayerView {
  id: string;
  name: string;
  life: number;
  deckCount: number;
  handCount: number;
  graveyardCount: number;
  exileCount: number;
  hand: PublicCardView[]; // full for viewer, [] for others
  battlefield: PublicCardView[];
  graveyard: PublicCardView[]; // discard is public — both weavers see the pile
  exile: PublicCardView[]; // purge is public — both weavers see the pile
  /** Top-of-deck cards this viewer is privately looking at (own deck only). */
  deckPeek: PublicCardView[];
}

/** One spell waiting on the shared spell stack, top-first in the view (index 0 resolves next). */
export interface PublicSpellStackEntry {
  card: PublicCardView;
  casterId: string;
  casterName: string;
}

/** A visual targeting arrow between two cards in play — purely informational, public to both weavers. */
export interface PublicTargetArrow {
  sourceCardId: string;
  targetCardId: string;
}

export interface ClientGameView {
  gameId: string;
  you: string;
  turnPlayerId: string;
  turnNumber: number;
  roundNumber: number;
  phase: string;
  winnerPlayerId?: string;
  players: Record<string, PublicPlayerView>;
  looms: Record<string, PublicThreadView[]>;
  /** The shared spell stack, public to both weavers — newest cast first (resolves first). */
  spellStack: PublicSpellStackEntry[];
  /** Visual targeting arrows between cards in play — public, purely informational (no game effect). */
  targetArrows: PublicTargetArrow[];
  /** Opening-hand decisions: true once a weaver has kept or reshuffled (public — the log counts aloud anyway). */
  mulliganed: Record<string, boolean>;
  legalActions: readonly GameAction[];
  log: string[];
}

function cardView(card: Card, onBattlefield: boolean): PublicCardView {
  const m = card.metadata as Record<string, unknown>;
  const power = (typeof m.power === "number" ? m.power : card.stats.attack) + (typeof m.powerBonus === "number" ? (m.powerBonus as number) : 0);
  const health = typeof m.healthRemaining === "number" ? (m.healthRemaining as number) : typeof m.health === "number" ? (m.health as number) : card.stats.health;
  const rawCost = Array.isArray(m.cost) ? (m.cost as unknown[]) : [];
  const cost = rawCost
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).colour === "string" && typeof (x as Record<string, unknown>).orientation === "string")
    .map((x) => ({ colour: x.colour as string, orientation: x.orientation as string }));
  const view: PublicCardView = {
    id: card.id,
    name: card.name,
    type: card.type,
    colour: typeof m.colour === "string" ? m.colour : "neutral",
    cost,
    power: Math.max(0, power),
    health,
    haste: m.haste === true,
    reaction: m.reaction === true ? true : undefined,
    text: typeof m.text === "string" ? m.text : "",
    rarity: typeof m.rarity === "string" ? m.rarity : "common",
  };
  if (onBattlefield) {
    view.lane = typeof m.lane === "number" ? m.lane : undefined;
    view.row = typeof m.row === "string" ? m.row : undefined;
    view.owner = typeof m.owner === "string" ? m.owner : undefined;
    view.attackedThisTurn = m.attackedThisTurn === true;
    view.movedThisTurn = m.movedThisTurn === true;
  }
  return view;
}

export function sanitizeStateForPlayer(state: GameState, playerId: string, ruleSet: RuleSet): ClientGameView {
  const players: Record<string, PublicPlayerView> = {};
  const peeks = parseDeckPeeks(state.metadata.deckPeek);
  for (const [id, p] of Object.entries(state.players)) {
    const isViewer = id === playerId;
    players[id] = {
      id,
      name: p.name,
      life: p.life,
      deckCount: p.deck.length,
      handCount: p.hand.length,
      graveyardCount: p.graveyard.length,
      exileCount: p.exile.length,
      hand: isViewer ? p.hand.map((c) => cardView(c, false)) : [],
      battlefield: p.battlefield.map((c) => cardView(c, true)),
      graveyard: p.graveyard.map((c) => cardView(c, false)),
      exile: p.exile.map((c) => cardView(c, false)),
      deckPeek: isViewer
        ? (peeks[id]?.ids ?? []).map((cid) => p.deck.find((c) => c.id === cid)).filter((c): c is Card => !!c).map((c) => cardView(c, false))
        : [],
    };
  }

  const looms: Record<string, PublicThreadView[]> = {};
  for (const [pid, threads] of Object.entries(parseLooms(state.metadata.looms) ?? {})) {
    looms[pid] = threads.map((t) => ({ id: t.id, colour: t.colour, orientation: t.orientation, exhausted: t.exhausted, token: t.token === true ? true : undefined, excite: t.excite ? t.excite : undefined }));
  }

  const log = Array.isArray(state.metadata.log) ? (state.metadata.log as unknown[]).filter((x): x is string => typeof x === "string") : [];

  // The shared spell stack is public — reverse so the view lists the top (newest, resolves first) at index 0.
  const spellStack: PublicSpellStackEntry[] = parseSpellStack(state.metadata.spellStack)
    .slice()
    .reverse()
    .map((e) => ({ card: cardView(e.card, false), casterId: e.casterId, casterName: state.players[e.casterId]?.name ?? e.casterId }));

  return {
    gameId: state.gameId,
    you: playerId,
    turnPlayerId: state.turnPlayerId,
    turnNumber: state.turnNumber,
    roundNumber: Math.ceil(state.turnNumber / 2),
    phase: state.phase,
    winnerPlayerId: state.winnerPlayerId,
    players,
    looms,
    spellStack,
    targetArrows: parseTargetArrows(state.metadata.targetArrows).map((a) => ({ ...a })),
    mulliganed: parseFlags(state.metadata.mulliganed),
    legalActions: state.winnerPlayerId ? [] : ruleSet.listLegalActions(state, playerId),
    log: log.slice(-60),
  };
}
