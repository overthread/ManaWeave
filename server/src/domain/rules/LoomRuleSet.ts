/**
 * ManaWeave ruleset.
 *
 * Board: 3 lanes x 2 rows (front/back) per player = 6 slots (12 on the board).
 * Loom: 4 threads per player; a card's cost is a list of coloured orientations
 *       (e.g. ember:up + ember:left) and exhausting (flipping) one ready thread
 *       matching each entry's colour and direction pays for it ("any"-colour
 *       entries take a thread of any colour).
 *       All own threads ready at the start of each of your rounds; during the
 *       weave step you may rotate ONE thread 90° cw or ccw once per round —
 *       rotating ahead is how you unlock orientation costs.
 * Combat: only front-row units attack, into their own lane. Attacking is a
 *       declaration — the unit exhausts and that's it. All damage and every
 *       card effect (spells, "when woven" triggers) is resolved BY HAND via
 *       unrestricted manual actions: either player, any time, no restrictions
 *       beyond targets existing and amounts being sane integers.
 */

import type { Card, CostEntry, ThreadColour } from "../card/Card.js";
import { createCardFromDefinition } from "../card/CardDefinitions.js";
import type { GameState, PlayerState } from "../game/GameState.js";
import type { GameAction, LaneRow, ManualAction, PlayCardAction, WeaveDirection } from "../actions/GameAction.js";
import type { RuleSet } from "./RuleSet.js";
import { GameRuleViolationError } from "./GameRuleViolationError.js";
import {
  DECK_MAX_SIZE,
  DECK_MIN_SIZE,
  LANES,
  LOOM_SIZE,
  MAX_COPIES_PER_CARD,
  STARTING_HAND_SIZE,
  STARTING_LIFE,
  THREAD_COLOURS,
} from "./deckRules.js";

// ------------------------------------------------------------------ threads

export interface Thread {
  id: string;
  colour: ThreadColour;
  orientation: number; // 0=up 1=right 2=down 3=left
  exhausted: boolean;
}

export const ORIENTATION_NAMES = ["up", "right", "down", "left"] as const;

interface LoomsMetadata {
  [playerId: string]: Thread[];
}
interface FlagsMetadata {
  [playerId: string]: boolean;
}

export function parseLooms(value: unknown): LoomsMetadata | null {
  if (!value || typeof value !== "object") return null;
  const out: LoomsMetadata = {};
  for (const [pid, threads] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(threads)) return null;
    const list: Thread[] = [];
    for (const t of threads) {
      if (!t || typeof t !== "object") return null;
      const th = t as Partial<Thread>;
      if (typeof th.id !== "string") return null;
      if (typeof th.colour !== "string") return null;
      const orientation = typeof th.orientation === "number" ? Math.max(0, Math.min(3, Math.floor(th.orientation))) : 0;
      list.push({ id: th.id, colour: th.colour as ThreadColour, orientation, exhausted: th.exhausted === true });
    }
    out[pid] = list;
  }
  return out;
}

function parseFlags(value: unknown): FlagsMetadata {
  if (!value || typeof value !== "object") return {};
  const out: FlagsMetadata = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = v === true;
  return out;
}

/**
 * parseLooms returns fresh objects, so anything that MUTATES threads must go
 * through this helper: it re-stores the parsed looms into metadata so later
 * mutations land in the real (cloned) state.
 */
function mutableLooms(meta: Record<string, unknown>): LoomsMetadata {
  const looms = parseLooms(meta.looms) ?? {};
  meta.looms = looms;
  return looms;
}

function parseLog(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

/**
 * Private deck peeks: { playerId: { amount, ids } }. Only ever shipped to that
 * player's own sanitized view; refreshed after every action so it always mirrors
 * the current deck order (draws/shuffles/moves re-snapshot automatically).
 */
export interface DeckPeekMetadata {
  [playerId: string]: { amount: number; ids: string[] };
}

export function parseDeckPeeks(value: unknown): DeckPeekMetadata {
  if (!value || typeof value !== "object") return {};
  const out: DeckPeekMetadata = {};
  for (const [pid, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { amount?: unknown; ids?: unknown };
    if (typeof e.amount !== "number" || !Array.isArray(e.ids)) continue;
    out[pid] = { amount: e.amount, ids: e.ids.filter((x): x is string => typeof x === "string") };
  }
  return out;
}

/** Deterministic RNG (mulberry32) with state persisted in metadata. */
function nextRandom(meta: Record<string, unknown>): number {
  let s = (typeof meta.rngState === "number" ? meta.rngState : Date.now() >>> 0) >>> 0;
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const val = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  meta.rngState = s;
  return val;
}

// -------------------------------------------------------------- card helpers

function meta(card: Card): Record<string, unknown> {
  return card.metadata as Record<string, unknown>;
}

function powerOf(card: Card): number {
  const base = typeof meta(card).power === "number" ? (meta(card).power as number) : card.stats.attack;
  const bonus = typeof meta(card).powerBonus === "number" ? (meta(card).powerBonus as number) : 0;
  return Math.max(0, base + bonus);
}

function healthOf(card: Card): number {
  const hr = meta(card).healthRemaining;
  if (typeof hr === "number") return hr;
  return typeof meta(card).health === "number" ? (meta(card).health as number) : card.stats.health;
}

function unitLane(card: Card): number | undefined {
  const v = meta(card).lane;
  return typeof v === "number" ? v : undefined;
}

function unitRow(card: Card): LaneRow | undefined {
  const v = meta(card).row;
  return v === "front" || v === "back" ? v : undefined;
}

function unitAt(state: GameState, playerId: string, lane: number, row: LaneRow): Card | undefined {
  return state.players[playerId]?.battlefield.find((c) => unitLane(c) === lane && unitRow(c) === row);
}

function opponentOf(state: GameState, playerId: string): string {
  return Object.keys(state.players).find((id) => id !== playerId) as string;
}

// ------------------------------------------------------- thread combinations

function threadCombos(threads: readonly Thread[], size: number): Thread[][] {
  const out: Thread[][] = [];
  const build = (start: number, acc: Thread[]): void => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < threads.length; i++) build(i + 1, [...acc, threads[i]!]);
  };
  build(0, []);
  return out;
}

/**
 * All legal exhaustion sets for a card: unexhausted threads, one per cost entry,
 * each thread matching that entry's colour ("any" matches every colour) and
 * orientation exactly.
 */
function costOf(card: Card): readonly CostEntry[] {
  const m = meta(card).cost;
  if (Array.isArray(m) && m.every((x) => x && typeof x === "object" && typeof (x as CostEntry).colour === "string" && typeof (x as CostEntry).orientation === "string")) {
    return m as CostEntry[];
  }
  return Array.isArray(card.stats.cost) ? card.stats.cost : [];
}

function threadCovers(thread: Thread, entry: CostEntry): boolean {
  if (ORIENTATION_NAMES[thread.orientation] !== entry.orientation) return false;
  return entry.colour === "any" || entry.colour === "neutral" || entry.colour === thread.colour;
}

/** One-to-one assignment of threads to cost entries (backtracking; sizes are <= 4). */
function comboMatches(combo: readonly Thread[], cost: readonly CostEntry[]): boolean {
  const used = new Array<boolean>(combo.length).fill(false);
  const assign = (i: number): boolean => {
    if (i === cost.length) return true;
    for (let j = 0; j < combo.length; j++) {
      if (used[j] || !threadCovers(combo[j]!, cost[i]!)) continue;
      used[j] = true;
      if (assign(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return assign(0);
}

function payableCombos(loom: readonly Thread[], card: Card): Thread[][] {
  const cost = costOf(card);
  const available = loom.filter((t) => !t.exhausted);
  if (available.length < cost.length) return [];
  return threadCombos(available, cost.length).filter((combo) => comboMatches(combo, cost));
}

// -------------------------------------------------------------- effect scope

/** Effect kinds whose manual application targets a battlefield unit. */
const UNIT_TARGET_KINDS = new Set(["damage_unit", "buff_unit", "return_to_hand", "destroy_unit"]);
const THREAD_TARGET_KINDS = new Set(["ready_thread", "exhaust_thread", "rotate_thread"]);
const PLAYER_TARGET_KINDS = new Set(["damage_face", "heal_face", "draw", "purge_deck_top", "peek_deck", "shuffle_deck"]);
/** Targets a card in any zone of either weaver (send-to-area moves). */
const ANY_CARD_TARGET_KINDS = new Set(["move_card"]);
const ALL_EFFECT_KINDS = new Set([
  "damage_unit",
  "damage_face",
  "heal_face",
  "buff_unit",
  "draw",
  "ready_thread",
  "exhaust_thread",
  "rotate_thread",
  "return_to_hand",
  "destroy_unit",
  "purge_deck_top",
  "peek_deck",
  "shuffle_deck",
  "move_card",
]);

const ZONE_KEYS = ["hand", "deck", "graveyard", "exile"] as const;
type ZoneKey = (typeof ZONE_KEYS)[number];

// ==================================================================== ruleset

export class LoomRuleSet implements RuleSet {
  readonly id = "manaweave";
  readonly version = "3.1.0";

  // ------------------------------------------------------------- validation

  validateDeck(deck: readonly Card[]): { ok: boolean; reason?: string } {
    if (deck.length < DECK_MIN_SIZE) return { ok: false, reason: `Deck must have at least ${DECK_MIN_SIZE} cards (has ${deck.length}).` };
    if (deck.length > DECK_MAX_SIZE) return { ok: false, reason: `Deck must have at most ${DECK_MAX_SIZE} cards (has ${deck.length}).` };
    const counts = new Map<string, number>();
    for (const c of deck) {
      const base = typeof meta(c).baseCardId === "string" ? (meta(c).baseCardId as string) : c.id;
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    for (const [baseId, n] of counts) {
      if (n > MAX_COPIES_PER_CARD) return { ok: false, reason: `Too many copies of ${baseId} (${n} > ${MAX_COPIES_PER_CARD}).` };
    }
    return { ok: true };
  }

  validateLoom(loom: readonly ThreadColour[], deck: readonly Card[]): { ok: boolean; reason?: string } {
    if (!Array.isArray(loom) || loom.length !== LOOM_SIZE) return { ok: false, reason: `Loom must hold exactly ${LOOM_SIZE} threads.` };
    for (const colour of loom) {
      if (colour === "neutral") return { ok: false, reason: "Threads cannot be neutral." };
      if (!THREAD_COLOURS.includes(colour)) return { ok: false, reason: `Unknown thread colour: ${String(colour)}.` };
    }
    const loomCounts = new Map<ThreadColour, number>();
    for (const colour of loom) loomCounts.set(colour, (loomCounts.get(colour) ?? 0) + 1);
    // Every card must be payable by this loom: enough threads of each cost colour.
    const needed = new Map<ThreadColour, number>();
    for (const c of deck) {
      const perCard = new Map<ThreadColour, number>();
      for (const entry of costOf(c)) {
        if (entry.colour === "any" || entry.colour === "neutral") continue;
        perCard.set(entry.colour, (perCard.get(entry.colour) ?? 0) + 1);
      }
      for (const [colour, n] of perCard) needed.set(colour, Math.max(needed.get(colour) ?? 0, n));
    }
    for (const [colour, n] of needed) {
      const have = loomCounts.get(colour) ?? 0;
      if (have < n) {
        const example = deck.find((c) => costOf(c).some((e) => e.colour === colour))!;
        return { ok: false, reason: `${example.name} needs ${n} ${colour} thread(s) but the loom has ${have}.` };
      }
    }
    return { ok: true };
  }

  private deriveLoom(deck: readonly Card[]): ThreadColour[] {
    const counts = new Map<ThreadColour, number>();
    for (const c of deck) {
      const colour = meta(c).colour as ThreadColour | undefined;
      if (colour && colour !== "neutral") counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || THREAD_COLOURS.indexOf(a[0]) - THREAD_COLOURS.indexOf(b[0]));
    if (ranked.length === 0) return [...THREAD_COLOURS];
    if (ranked.length === 1) return [ranked[0]![0], ranked[0]![0], ranked[0]![0], ranked[0]![0]];
    return [ranked[0]![0], ranked[0]![0], ranked[1]![0], ranked[1]![0]];
  }

  // ---------------------------------------------------------- initialization

  initializeGame(
    gameId: string,
    playerDecks: Record<string, readonly Card[]>,
    playerNames?: Record<string, string>,
    playerLooms?: Record<string, readonly ThreadColour[]>,
  ): GameState {
    const ids = Object.keys(playerDecks);
    if (ids.length !== 2) throw new GameRuleViolationError("ManaWeave is a 2-player game.");
    for (const id of ids) {
      const v = this.validateDeck(playerDecks[id]!);
      if (!v.ok) throw new GameRuleViolationError(`Deck for ${id} invalid: ${v.reason}`);
      const loom = playerLooms?.[id];
      if (loom) {
        const lv = this.validateLoom(loom, playerDecks[id]!);
        if (!lv.ok) throw new GameRuleViolationError(`Loom for ${id} invalid: ${lv.reason}`);
      }
    }

    const metadata: Record<string, unknown> = { rngState: (Date.now() ^ gameId.length) >>> 0 };
    const players: Record<string, PlayerState> = {};
    const looms: LoomsMetadata = {};
    const log: string[] = [`The looms are strung — ${ids.map((id) => playerNames?.[id] ?? id).join(" vs ")} begin.`];

    for (const pid of ids) {
      // Re-stamp with unique instance ids, preserving definition ids.
      const deck = [...playerDecks[pid]!].map((c, i) => {
        const baseId = typeof meta(c).baseCardId === "string" ? (meta(c).baseCardId as string) : c.id;
        const fresh = createCardFromDefinition(baseId, `${pid}-${i + 1}-${baseId}`);
        return fresh;
      });
      // Fisher-Yates with the deterministic RNG.
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(nextRandom(metadata) * (i + 1));
        [deck[i], deck[j]] = [deck[j]!, deck[i]!];
      }
      const hand = deck.splice(0, STARTING_HAND_SIZE);
      for (const c of hand) c.metadata.zone = "hand";
      players[pid] = {
        id: pid,
        name: playerNames?.[pid] ?? pid,
        life: STARTING_LIFE,
        energy: 0,
        deck,
        hand,
        battlefield: [],
        graveyard: [],
        exile: [],
      };
      const colours = playerLooms?.[pid] ?? this.deriveLoom(playerDecks[pid]!);
      looms[pid] = colours.map((colour, i) => ({ id: `${pid}-thread-${i + 1}`, colour, orientation: 0, exhausted: false }));
      log.push(`${players[pid]!.name} strings a loom of ${colours.map((c) => c).join(", ")}.`);
    }

    const first = ids[0]!;
    const state: GameState = {
      gameId,
      players,
      turnPlayerId: first,
      turnNumber: 1,
      phase: "main",
      metadata: { ...metadata, looms, weaved: {}, log },
    };
    this.beginRound(state, first);
    return state;
  }

  // ---------------------------------------------------------- legal actions

  listLegalActions(state: GameState, playerId: string): readonly GameAction[] {
    const actions: GameAction[] = [];
    const base = { gameId: state.gameId, playerId };
    actions.push({ ...base, type: "concede" });
    if (state.winnerPlayerId || playerId !== state.turnPlayerId) return actions;

    const me = state.players[playerId]!;
    const loom = parseLooms(state.metadata.looms)?.[playerId] ?? [];

    if (state.phase === "main") {
      // Move back-row units forward (same lane, front slot free, once per round).
      for (const unit of me.battlefield) {
        if (unitRow(unit) !== "back" || meta(unit).movedThisTurn === true) continue;
        const lane = unitLane(unit)!;
        if (unitAt(state, playerId, lane, "front")) continue;
        actions.push({ ...base, type: "move_unit", cardId: unit.id });
      }

      // Attack with eligible front-row units.
      for (const unit of me.battlefield) {
        if (unitRow(unit) !== "front" || meta(unit).attackedThisTurn === true) continue;
        const sick = meta(unit).summonedTurn === state.turnNumber && meta(unit).haste !== true;
        if (sick) continue;
        actions.push({ ...base, type: "attack", cardId: unit.id });
      }

      // Play cards — every payable thread combination x every placement.
      // Spells need no target: their effects are resolved by hand afterwards.
      for (const card of me.hand) {
        const combos = payableCombos(loom, card);
        if (combos.length === 0) continue;
        const threadIds = (combo: Thread[]) => combo.map((t) => t.id);
        if (card.type === "unit") {
          for (let lane = 0; lane < LANES; lane++) {
            for (const row of ["front", "back"] as const) {
              if (unitAt(state, playerId, lane, row)) continue;
              for (const combo of combos) {
                actions.push({
                  ...base,
                  type: "play_card",
                  cardId: card.id,
                  threadIds: threadIds(combo),
                  laneIndex: lane,
                  row,
                } satisfies PlayCardAction);
              }
            }
          }
        } else {
          for (const combo of combos) {
            actions.push({ ...base, type: "play_card", cardId: card.id, threadIds: threadIds(combo), laneIndex: null, row: null });
          }
        }
      }

      actions.push({ ...base, type: "advance_phase" });
      actions.push({ ...base, type: "end_turn" });
      return actions;
    }

    // Weave step: rotate one thread 90°, once per round.
    const weaved = parseFlags(state.metadata.weaved);
    if (!weaved[playerId]) {
      for (const t of loom) {
        for (const direction of ["cw", "ccw"] as const) {
          actions.push({ ...base, type: "weave_thread", threadId: t.id, direction });
        }
      }
    }
    actions.push({ ...base, type: "end_turn" });
    return actions;
  }

  // ------------------------------------------------------------- application

  applyAction(state: GameState, action: GameAction): GameState {
    const next = this.cloneState(state);
    switch (action.type) {
      case "play_card":
        this.applyPlayCard(next, action);
        break;
      case "move_unit":
        this.applyMoveUnit(next, action);
        break;
      case "attack":
        this.applyAttack(next, action);
        break;
      case "weave_thread":
        this.applyWeave(next, action);
        break;
      case "advance_phase":
        if (next.phase !== "main") throw new GameRuleViolationError("Cannot advance from the weave step.");
        next.phase = "weave";
        this.log(next, `${this.nameOf(next, action.playerId)} pauses at the weave step.`);
        break;
      case "end_turn": {
        const nextPlayer = opponentOf(next, action.playerId);
        next.turnPlayerId = nextPlayer;
        next.turnNumber += 1;
        next.phase = "main";
        this.beginRound(next, nextPlayer);
        break;
      }
      case "concede": {
        const winner = opponentOf(next, action.playerId);
        next.winnerPlayerId = winner;
        this.log(next, `${this.nameOf(next, action.playerId)} concedes. ${this.nameOf(next, winner)} wins!`);
        break;
      }
      case "manual_action":
        this.applyManualAction(next, action);
        break;
      default:
        return next;
    }
    this.refreshDeckPeeks(next);
    this.sweepDeaths(next);
    return next;
  }

  getWinner(state: GameState): string | undefined {
    if (state.winnerPlayerId) return state.winnerPlayerId;
    const ids = Object.keys(state.players);
    const dead = ids.filter((id) => state.players[id]!.life <= 0);
    if (dead.length === 0) return undefined;
    if (dead.length === ids.length) return opponentOf(state, state.turnPlayerId);
    return ids.find((id) => !dead.includes(id))!;
  }

  // ------------------------------------------------------- applyAction cases

  private applyPlayCard(state: GameState, action: PlayCardAction): void {
    const me = state.players[action.playerId]!;
    const handIndex = me.hand.findIndex((c) => c.id === action.cardId);
    if (handIndex < 0) throw new GameRuleViolationError("Card is not in your hand.");
    const card = me.hand[handIndex]!;
    const loom = mutableLooms(state.metadata)[action.playerId] ?? [];

    // Exhaust exactly the chosen threads (defensive re-validation).
    const chosen = (action.threadIds ?? []).map((id) => loom.find((t) => t.id === id));
    if (chosen.some((t) => !t)) throw new GameRuleViolationError("Unknown thread.");
    const cost = costOf(card);
    if (chosen.length !== cost.length) throw new GameRuleViolationError("Wrong number of threads exhausted.");
    const payable = payableCombos(loom, card).some((combo) => combo.length === chosen.length && combo.every((t) => chosen.includes(t)));
    if (!payable) throw new GameRuleViolationError("Those threads' colours/orientations cannot pay for this card.");
    for (const t of chosen) t!.exhausted = true;

    me.hand.splice(handIndex, 1);
    const cardName = card.name;

    if (card.type === "unit") {
      const lane = action.laneIndex;
      const row = action.row;
      if (typeof lane !== "number" || (row !== "front" && row !== "back")) throw new GameRuleViolationError("Units need a lane and row.");
      if (unitAt(state, action.playerId, lane, row)) throw new GameRuleViolationError("That slot is occupied.");
      card.metadata.zone = "battlefield";
      card.metadata.owner = action.playerId;
      card.metadata.lane = lane;
      card.metadata.row = row;
      card.metadata.summonedTurn = state.turnNumber;
      card.metadata.attackedThisTurn = false;
      card.metadata.movedThisTurn = false;
      card.metadata.healthRemaining = card.stats.health;
      me.battlefield.push(card);
      this.log(state, `${me.name} weaves ${cardName} into lane ${lane + 1} (${row} row).`);
    } else {
      this.log(state, `${me.name} casts ${cardName} — resolve its effect by hand.`);
      card.metadata.zone = "graveyard";
      me.graveyard.push(card);
    }
  }

  private applyMoveUnit(state: GameState, action: { playerId: string; cardId: string }): void {
    const me = state.players[action.playerId]!;
    const unit = me.battlefield.find((c) => c.id === action.cardId);
    if (!unit || unitRow(unit) !== "back") throw new GameRuleViolationError("Only back-row units can step forward.");
    if (meta(unit).movedThisTurn === true) throw new GameRuleViolationError("This unit already moved this round.");
    const lane = unitLane(unit)!;
    if (unitAt(state, action.playerId, lane, "front")) throw new GameRuleViolationError("The front slot in that lane is occupied.");
    unit.metadata.row = "front";
    unit.metadata.movedThisTurn = true;
    this.log(state, `${me.name}'s ${unit.name} steps up to the front of lane ${lane + 1}.`);
  }

  /** Attacking is a declaration only: the unit exhausts, damage is resolved by hand. */
  private applyAttack(state: GameState, action: { playerId: string; cardId: string }): void {
    const me = state.players[action.playerId]!;
    const attacker = me.battlefield.find((c) => c.id === action.cardId);
    if (!attacker || unitRow(attacker) !== "front") throw new GameRuleViolationError("Only front-row units can attack.");
    if (meta(attacker).attackedThisTurn === true) throw new GameRuleViolationError("This unit already attacked this round.");
    if (meta(attacker).summonedTurn === state.turnNumber && meta(attacker).haste !== true) {
      throw new GameRuleViolationError("This unit has summoning sickness.");
    }
    const enemyId = opponentOf(state, action.playerId);
    const lane = unitLane(attacker)!;
    attacker.metadata.attackedThisTurn = true;
    const what = unitAt(state, enemyId, lane, "front")
      ? `the enemy front unit`
      : unitAt(state, enemyId, lane, "back")
        ? `the enemy back unit`
        : `${state.players[enemyId]!.name} directly`;
    this.log(state, `${attacker.name} attacks down lane ${lane + 1} at ${what} (exhausted) — resolve the damage by hand.`);
  }

  private applyWeave(state: GameState, action: { playerId: string; threadId: string; direction: WeaveDirection }): void {
    const weaved = parseFlags(state.metadata.weaved);
    if (weaved[action.playerId]) throw new GameRuleViolationError("You already wove this round.");
    if (state.phase !== "weave") throw new GameRuleViolationError("Weaving happens in the weave step.");
    const loom = mutableLooms(state.metadata)[action.playerId] ?? [];
    const thread = loom.find((t) => t.id === action.threadId);
    if (!thread) throw new GameRuleViolationError("Unknown thread.");
    thread.orientation = (thread.orientation + (action.direction === "cw" ? 1 : 3)) % 4;
    state.metadata.weaved = { ...weaved, [action.playerId]: true };
    this.log(state, `${this.nameOf(state, action.playerId)} weaves a ${thread.colour} thread to point ${ORIENTATION_NAMES[thread.orientation]}.`);
  }

  // ------------------------------------------------------------- effects

  /**
   * Hand-resolved effect. Unrestricted by design: either weaver may fire it at
   * any time (the engine exempts manual actions from turn/legality gating) —
   * the only validation is that targets exist and amounts are sane integers.
   */
  private applyManualAction(state: GameState, action: ManualAction): void {
    const effect = action.effect;
    if (!effect || !ALL_EFFECT_KINDS.has(effect.kind)) throw new GameRuleViolationError("Unknown manual effect kind.");
    const actor = this.nameOf(state, action.playerId);
    const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(-999, Math.min(999, Math.floor(v))) : 0);
    const amount = Math.max(0, int(effect.amount));
    if (UNIT_TARGET_KINDS.has(effect.kind)) {
      const target = this.findBattlefieldUnit(state, action.targetCardId);
      if (!target) throw new GameRuleViolationError("Pick a unit on the battlefield.");
      switch (effect.kind) {
        case "damage_unit":
          target.metadata.healthRemaining = healthOf(target) - amount;
          this.log(state, `⟡ ${actor} marks ${amount} damage on ${target.name}.`);
          break;
        case "buff_unit": {
          const atk = int(effect.atk);
          const hp = int(effect.hp);
          target.metadata.powerBonus = powerOf(target) - (typeof meta(target).power === "number" ? (meta(target).power as number) : target.stats.attack) + atk;
          target.metadata.healthRemaining = healthOf(target) + hp;
          this.log(state, `⟡ ${actor} alters ${target.name} by ${atk >= 0 ? "+" : ""}${atk}/${hp >= 0 ? "+" : ""}${hp}.`);
          break;
        }
        case "return_to_hand": {
          const owner = state.players[typeof meta(target).owner === "string" ? (meta(target).owner as string) : action.playerId]!;
          owner.battlefield = owner.battlefield.filter((c) => c.id !== target.id);
          this.stripUnitMarkers(target);
          target.metadata.zone = "hand";
          owner.hand.push(target);
          this.log(state, `⟡ ${actor} pulls ${target.name} back to ${owner.name}'s hand.`);
          break;
        }
        case "destroy_unit":
          target.metadata.healthRemaining = 0;
          this.log(state, `⟡ ${actor} severs ${target.name} from the pattern.`);
          break;
      }
      this.sweepDeaths(state);
      return;
    }
    if (THREAD_TARGET_KINDS.has(effect.kind)) {
      const thread = this.findThread(state, action.targetThreadId);
      switch (effect.kind) {
        case "ready_thread":
          thread.exhausted = false;
          this.log(state, `⟡ ${actor} readies a ${thread.colour} thread.`);
          break;
        case "exhaust_thread":
          thread.exhausted = true;
          this.log(state, `⟡ ${actor} flips a ${thread.colour} thread (exhausted).`);
          break;
        case "rotate_thread": {
          if (action.targetDirection !== "cw" && action.targetDirection !== "ccw") throw new GameRuleViolationError("Choose a rotation direction.");
          thread.orientation = (thread.orientation + (action.targetDirection === "cw" ? 1 : 3)) % 4;
          this.log(state, `⟡ ${actor} turns a ${thread.colour} thread to point ${ORIENTATION_NAMES[thread.orientation]}.`);
          break;
        }
      }
      return;
    }
    if (PLAYER_TARGET_KINDS.has(effect.kind)) {
      const target = this.playerTarget(state, action.targetPlayerId);
      switch (effect.kind) {
        case "damage_face":
          target.life -= amount;
          this.log(state, `⟡ ${actor} marks ${amount} damage on ${target.name} (${Math.max(0, target.life)} life left).`);
          break;
        case "heal_face":
          target.life += amount;
          this.log(state, `⟡ ${actor} raises ${target.name}'s life by ${amount} (${target.life} total).`);
          break;
        case "draw":
          for (let i = 0; i < amount; i++) this.drawCard(state, target.id);
          this.log(state, `⟡ ${actor} has ${target.name} draw ${amount} card(s).`);
          break;
        case "purge_deck_top": {
          let purged = 0;
          for (let i = 0; i < amount; i++) {
            const top = target.deck.shift();
            if (!top) break;
            top.metadata.zone = "exile";
            target.exile.push(top);
            purged++;
          }
          this.log(state, `⟡ ${actor} purges ${purged} card(s) from the top of ${target.name}'s deck.`);
          break;
        }
        case "peek_deck": {
          if (target.id !== action.playerId) throw new GameRuleViolationError("You can only look at your own deck.");
          const peeks = parseDeckPeeks(state.metadata.deckPeek);
          if (amount <= 0) {
            delete peeks[target.id];
            state.metadata.deckPeek = peeks;
            this.log(state, `⟡ ${actor} looks away from the deck top.`);
          } else {
            peeks[target.id] = { amount, ids: target.deck.slice(0, amount).map((c) => c.id) };
            state.metadata.deckPeek = peeks;
            this.log(state, `⟡ ${actor} privately looks at the top ${amount} card(s) of their deck.`);
          }
          break;
        }
        case "shuffle_deck": {
          for (let i = target.deck.length - 1; i > 0; i--) {
            const j = Math.floor(nextRandom(state.metadata) * (i + 1));
            [target.deck[i], target.deck[j]] = [target.deck[j]!, target.deck[i]!];
          }
          this.log(state, `⟡ ${actor} shuffles ${target === state.players[action.playerId] ? "their" : `${target.name}'s`} deck.`);
          break;
        }
      }
      return;
    }
    if (ANY_CARD_TARGET_KINDS.has(effect.kind)) {
      // move_card: send the targeted card (any zone, either weaver) to another area.
      const zone = effect.zone;
      if (!zone || !ZONE_KEYS.includes(zone)) throw new GameRuleViolationError("Pick a destination area.");
      const loc = this.findCardAnywhere(state, action.targetCardId);
      if (!loc) throw new GameRuleViolationError("Card not found in any area.");
      const owner = loc.player;
      const card = loc.card;
      const cardName = card.name;
      const sourceZone = loc.zone === "graveyard" ? "the discard" : loc.zone === "exile" ? "the purge" : loc.zone === "battlefield" ? "the battlefield" : `their ${loc.zone}`;
      owner[loc.zone] = owner[loc.zone].filter((c) => c.id !== card.id);
      if (loc.zone === "battlefield") this.stripUnitMarkers(card);
      card.metadata.zone = zone;
      if (zone === "deck") {
        if (effect.position === "bottom") owner.deck.push(card);
        else owner.deck.unshift(card);
      } else {
        owner[zone].push(card);
      }
      const destZone = zone === "graveyard" ? "the discard" : zone === "exile" ? "the purge" : zone === "deck" ? `their deck (${effect.position === "bottom" ? "bottom" : "top"})` : `their hand`;
      this.log(state, `⟡ ${actor} moves ${cardName} from ${sourceZone} to ${destZone}.`);
      return;
    }
    throw new GameRuleViolationError("Unknown manual effect kind.");
  }

  private playerTarget(state: GameState, playerId: string | undefined): PlayerState {
    const p = playerId ? state.players[playerId] : undefined;
    if (!p) throw new GameRuleViolationError("Pick a weaver.");
    return p;
  }

  private findThread(state: GameState, threadId: string | undefined): Thread {
    if (!threadId) throw new GameRuleViolationError("Pick a thread.");
    for (const threads of Object.values(mutableLooms(state.metadata))) {
      const hit = threads.find((t) => t.id === threadId);
      if (hit) return hit;
    }
    throw new GameRuleViolationError("Unknown thread.");
  }

  private findBattlefieldUnit(state: GameState, cardId: string | undefined): Card | undefined {
    if (!cardId) return undefined;
    for (const p of Object.values(state.players)) {
      const hit = p.battlefield.find((c) => c.id === cardId);
      if (hit) return hit;
    }
    return undefined;
  }

  /** A unit leaving play sheds its board markers wherever it lands next. */
  private stripUnitMarkers(card: Card): void {
    for (const key of ["lane", "row", "owner", "summonedTurn", "attackedThisTurn", "movedThisTurn", "healthRemaining", "powerBonus"]) delete card.metadata[key];
  }

  /** Finds a card in any zone of either weaver (move_card targets). */
  private findCardAnywhere(
    state: GameState,
    cardId: string | undefined,
  ): { player: PlayerState; zone: "hand" | "deck" | "battlefield" | "graveyard" | "exile"; card: Card } | undefined {
    if (!cardId) return undefined;
    for (const p of Object.values(state.players)) {
      for (const zone of ["hand", "deck", "battlefield", "graveyard", "exile"] as const) {
        const hit = p[zone].find((c) => c.id === cardId);
        if (hit) return { player: p, zone, card: hit };
      }
    }
    return undefined;
  }

  /** Re-snapshot every open deck peek against the current deck order (ids only; replaced wholesale, never mutated). */
  private refreshDeckPeeks(state: GameState): void {
    const peeks = parseDeckPeeks(state.metadata.deckPeek);
    const pids = Object.keys(peeks);
    if (pids.length === 0) return;
    const next: DeckPeekMetadata = {};
    let changed = false;
    for (const pid of pids) {
      const entry = peeks[pid]!;
      const p = state.players[pid];
      if (!p) {
        changed = true;
        continue;
      }
      const fresh = p.deck.slice(0, entry.amount).map((c) => c.id);
      if (fresh.length === 0) {
        changed = true; // deck ran dry — close the peek
        continue;
      }
      if (fresh.join("\u0000") === entry.ids.join("\u0000")) next[pid] = entry;
      else {
        next[pid] = { amount: entry.amount, ids: fresh };
        changed = true;
      }
    }
    if (changed) state.metadata.deckPeek = next;
  }

  // ------------------------------------------------------------- lifecycle

  private beginRound(state: GameState, playerId: string): void {
    const p = state.players[playerId]!;
    const loom = mutableLooms(state.metadata)[playerId] ?? [];
    for (const t of loom) t.exhausted = false;
    for (const unit of p.battlefield) {
      unit.metadata.attackedThisTurn = false;
      unit.metadata.movedThisTurn = false;
    }
    const weaved = parseFlags(state.metadata.weaved);
    state.metadata.weaved = { ...weaved, [playerId]: false };
    this.drawCard(state, playerId);
    this.log(state, `— Round ${Math.ceil(state.turnNumber / 2)}: ${p.name}'s turn (threads ready, draws a card).`);
  }

  private drawCard(state: GameState, playerId: string): void {
    const p = state.players[playerId]!;
    const top = p.deck.shift();
    if (!top) {
      p.life -= 1;
      this.log(state, `${p.name}'s pattern frays — no cards left to draw, losing 1 life (${Math.max(0, p.life)} left).`);
      return;
    }
    top.metadata.zone = "hand";
    p.hand.push(top);
  }

  private sweepDeaths(state: GameState): void {
    for (const p of Object.values(state.players)) {
      const dead = p.battlefield.filter((c) => healthOf(c) <= 0);
      if (dead.length === 0) continue;
      p.battlefield = p.battlefield.filter((c) => healthOf(c) > 0);
      for (const d of dead) {
        d.metadata.zone = "graveyard";
        p.graveyard.push(d);
        this.log(state, `${d.name} unravels into the discard.`);
      }
    }
  }

  private log(state: GameState, message: string): void {
    const log = parseLog(state.metadata.log);
    log.push(message);
    state.metadata.log = log.slice(-200);
  }

  private nameOf(state: GameState, playerId: string): string {
    return state.players[playerId]?.name ?? playerId;
  }

  // ------------------------------------------------------------- cloning

  private cloneState(state: GameState): GameState {
    const players = Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [
        id,
        {
          ...p,
          deck: p.deck.map((c) => c.clone()),
          hand: p.hand.map((c) => c.clone()),
          battlefield: p.battlefield.map((c) => c.clone()),
          graveyard: p.graveyard.map((c) => c.clone()),
          exile: p.exile.map((c) => c.clone()),
        },
      ]),
    );
    const looms = parseLooms(state.metadata.looms);
    const clonedLooms: LoomsMetadata = {};
    for (const [pid, threads] of Object.entries(looms ?? {})) {
      clonedLooms[pid] = threads.map((t) => ({ ...t }));
    }
    return {
      ...state,
      players,
      metadata: {
        ...state.metadata,
        looms: clonedLooms,
        weaved: { ...parseFlags(state.metadata.weaved) },
        log: [...parseLog(state.metadata.log)],
      },
    };
  }
}
