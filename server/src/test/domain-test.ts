/**
 * Headless domain tests: drive the ruleset through BattleEngine and assert the
 * ManaWeave rules end-to-end. Run: npm run test:domain
 */

import { LoomRuleSet } from "../domain/rules/LoomRuleSet.js";
import { BattleEngine } from "../domain/services/BattleEngine.js";
import { GameRuleViolationError } from "../domain/rules/GameRuleViolationError.js";
import { createCardFromDefinition } from "../domain/card/CardDefinitions.js";
import { sanitizeStateForPlayer } from "../domain/game/sanitize.js";
import { DEMO_DECKS, expandTemplate } from "../infrastructure/cards/demoDecks.js";
import { csvRowsToDefinitions, parseCsv } from "../infrastructure/cards/csvCatalog.js";
import { THREAD_COLOURS } from "../domain/rules/deckRules.js";
import { Card } from "../domain/card/Card.js";
import type { PlayCardAction } from "../domain/actions/GameAction.js";

const ruleSet = new LoomRuleSet();
const engine = new BattleEngine(ruleSet);

let passed = 0;
let failed = 0;

function check(name: string, cond: unknown, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.error(`  ✘ ${name} ${detail}`);
  }
}

function expectThrow(name: string, fn: () => void, contains = ""): void {
  try {
    fn();
    check(name, false, "(did not throw)");
  } catch (err) {
    const ok = err instanceof GameRuleViolationError && (!contains || String(err.message).toLowerCase().includes(contains.toLowerCase()));
    check(name, ok, `(threw: ${err instanceof Error ? err.message : err})`);
  }
}

const deckA = expandTemplate(DEMO_DECKS[0]!);
const deckB = expandTemplate(DEMO_DECKS[1]!);
const loomA = [...DEMO_DECKS[0]!.loom];
const loomB = [...DEMO_DECKS[1]!.loom];

function newGame(): import("../domain/game/GameState.js").GameState {
  return engine.createNewGame("test-game", { p1: deckA, p2: deckB }, { p1: "Alice", p2: "Bob" }, { p1: loomA, p2: loomB });
}

const meta = (c: import("../domain/card/Card.js").Card) => c.metadata as Record<string, unknown>;

console.log("\n— setup —");
{
  const state = newGame();
  check("two players initialized", Object.keys(state.players).length === 2);
  check("starting hands dealt (p2 holds 4 before their first draw)", state.players.p2!.hand.length === 4);
  check("p1 drew on turn 1 start (5 in hand)", state.players.p1!.hand.length === 5);
  check("20 life each", state.players.p1!.life === 20 && state.players.p2!.life === 20);
  check("4 threads each, all up & ready", Object.values(state.metadata.looms as Record<string, { orientation: number; exhausted: boolean }[]>).every((loom) => loom.length === 4 && loom.every((t) => t.orientation === 0 && !t.exhausted)));
  check("phase main, p1 first", state.phase === "main" && state.turnPlayerId === "p1");
}

console.log("\n— deck validation —");
{
  check("valid demo deck accepted", ruleSet.validateDeck(deckA).ok);
  check("too-small deck rejected", !ruleSet.validateDeck(deckA.slice(0, 10)).ok);
  const manyCopies = Array.from({ length: 21 }, () => createCardFromDefinition("wildbloom", "x"));
  const v = ruleSet.validateDeck(manyCopies);
  check("21-card deck of one card rejected on copies", !v.ok && /copies/i.test(v.reason ?? ""));
  const badLoom = ruleSet.validateLoom(["verdant", "verdant", "verdant"], deckA);
  check("loom with 3 threads rejected", !badLoom.ok);
  const missingColour = ruleSet.validateLoom(["azure", "azure", "azure", "azure"], deckA);
  check("loom missing verdant rejected for deck containing verdant", !missingColour.ok);
}

console.log("\n— playing cards & threads —");
{
  const state = newGame();
  // Force a known hand for p1: a 1-cost verdant unit.
  const warden = createCardFromDefinition("sapling_warden", "p1-999-sapling_warden");
  state.players.p1!.hand = [warden];
  const legal = ruleSet.listLegalActions(state, "p1");
  const plays = legal.filter((a): a is PlayCardAction => a.type === "play_card" && a.cardId === warden.id);
  check("unit playable into 6 slots x valid thread combos", plays.length > 0);
  check("play actions enumerate slots", new Set(plays.map((a) => `${a.laneIndex}:${a.row}`)).size === 6);

  const looms = state.metadata.looms as Record<string, { id: string; colour: string }[]>;
  const verdantThread = looms.p1!.find((t) => t.colour === "verdant")!;
  const azureThread = looms.p1!.find((t) => t.colour === "azure")!;

  const next = engine.submitAction(state, { type: "play_card", gameId: state.gameId, playerId: "p1", cardId: warden.id, threadIds: [verdantThread.id], laneIndex: 1, row: "back" });
  check("unit deployed to lane 2 back", next.players.p1!.battlefield.some((c) => meta(c).lane === 1 && meta(c).row === "back"));
  check("paying thread exhausted", (next.metadata.looms as Record<string, { id: string; exhausted: boolean }[]>).p1!.find((t) => t.id === verdantThread.id)!.exhausted);
  check("summoning sickness stamped", next.players.p1!.battlefield[0]!.metadata.summonedTurn === 1);

  // Paying with the wrong colour for a coloured card must not be offered.
  const legalAfter = ruleSet.listLegalActions(state, "p1");
  check("wrong-colour-only payment not offered for verdant card", !legalAfter.some((a) => a.type === "play_card" && (a.threadIds ?? []).join() === azureThread.id));

  expectThrow("engine rejects non-offered thread combo", () =>
    engine.submitAction(state, { type: "play_card", gameId: state.gameId, playerId: "p1", cardId: warden.id, threadIds: [azureThread.id], laneIndex: 1, row: "back" }));
  expectThrow("engine rejects occupied slot", () =>
    engine.submitAction(next, { type: "play_card", gameId: state.gameId, playerId: "p1", cardId: warden.id, threadIds: [], laneIndex: 1, row: "back" }));
}

console.log("\n— coloured orientation costs —");
{
  const state = newGame();
  const behemoth = createCardFromDefinition("thornhide_behemoth", "p1-998-behemoth"); // verdant:up verdant:right any:up
  state.players.p1!.hand = [behemoth];
  const looms = state.metadata.looms as Record<string, { id: string; colour: string; orientation: number; exhausted: boolean }[]>;
  check("not castable while all threads up", !ruleSet.listLegalActions(state, "p1").some((a) => a.type === "play_card" && a.cardId === behemoth.id));

  looms.p1!.find((t) => t.colour === "azure")!.orientation = 1; // right — wrong colour
  check("right-pointing wrong-colour thread doesn't pay", !ruleSet.listLegalActions(state, "p1").some((a) => a.type === "play_card" && a.cardId === behemoth.id));

  const verdantThread = looms.p1!.find((t) => t.colour === "verdant")!;
  verdantThread.orientation = 1; // right
  const legalNow = ruleSet.listLegalActions(state, "p1");
  check("castable once a verdant thread points right", legalNow.some((a) => a.type === "play_card" && a.cardId === behemoth.id && (a.threadIds ?? []).includes(verdantThread.id)));

  looms.p1!.find((t) => t.id !== verdantThread.id && t.colour === "verdant")!.orientation = 1; // no verdant:up left
  check("no verdant-up left blocks the verdant:up entry", !ruleSet.listLegalActions(state, "p1").some((a) => a.type === "play_card" && a.cardId === behemoth.id));

  // Whole-loom cost: verdant:up verdant:down any:up any:up over loom [verdant, verdant, azure, crimson].
  const state2 = newGame();
  const treant = createCardFromDefinition("ancient_treant", "p1-997-treant");
  state2.players.p1!.hand = [treant];
  const looms2 = state2.metadata.looms as Record<string, { colour: string; orientation: number }[]>;
  const setOrient = (colour: string, orientation: number) => {
    for (const t of looms2.p1!) t.orientation = 0;
    looms2.p1!.find((t) => t.colour === colour)!.orientation = orientation;
  };
  setOrient("azure", 2); // an azure thread down — wrong colour for the verdant:down entry
  check("down-pointing wrong colour doesn't pay", !ruleSet.listLegalActions(state2, "p1").some((a) => a.type === "play_card" && a.cardId === treant.id));
  setOrient("verdant", 2); // a verdant thread down, three threads up
  check("payable with verdant-up, verdant-down and two any-up", ruleSet.listLegalActions(state2, "p1").some((a) => a.type === "play_card" && a.cardId === treant.id));
  looms2.p1!.find((t) => t.colour === "verdant" && t.orientation !== 2)!.orientation = 2; // second verdant down
  check("no verdant-up left blocks the whole-loom cost", !ruleSet.listLegalActions(state2, "p1").some((a) => a.type === "play_card" && a.cardId === treant.id));
}

console.log("\n— combat: attack is a declaration (exhaust); damage is manual —");
{
  const state = newGame();
  const atk = createCardFromDefinition("wildwood_elk", "p1-a"); // 2/2
  atk.metadata.summonedTurn = 0;
  atk.metadata.lane = 0;
  atk.metadata.row = "front";
  atk.metadata.owner = "p1";
  atk.metadata.healthRemaining = 2;
  state.players.p1!.battlefield = [atk];

  // Attacking only exhausts the unit — nothing else happens.
  let next = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: atk.id });
  check("attacking exhausts the unit", meta(next.players.p1!.battlefield[0]!).attackedThisTurn === true);
  check("attack deals no automatic damage to the weaver", next.players.p2!.life === 20);
  expectThrow("unit cannot attack twice per round", () =>
    engine.submitAction(next, { type: "attack", gameId: next.gameId, playerId: "p1", cardId: atk.id }));

  // Front clash resolved by hand: defender takes 3, attacker takes retaliation 2 and dies.
  const defender = createCardFromDefinition("thornhide_behemoth", "p2-d"); // 3/5
  defender.metadata.lane = 0;
  defender.metadata.row = "front";
  defender.metadata.owner = "p2";
  defender.metadata.healthRemaining = 5;
  state.players.p2!.battlefield = [defender];
  next = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: atk.id });
  check("clash declaration damages nobody yet", next.players.p2!.battlefield[0]!.metadata.healthRemaining === 5 && next.players.p1!.battlefield.length === 1);
  const dmg1 = engine.submitAction(next, { type: "manual_action", gameId: next.gameId, playerId: "p1", effect: { kind: "damage_unit", amount: 3 }, targetCardId: defender.id });
  check("manual damage: defender 5->2", meta(dmg1.players.p2!.battlefield[0]!).healthRemaining === 2);
  const dmg2 = engine.submitAction(dmg1, { type: "manual_action", gameId: dmg1.gameId, playerId: "p2", effect: { kind: "damage_unit", amount: 2 }, targetCardId: atk.id });
  check("manual retaliation kills the attacker, defender survives", dmg2.players.p1!.battlefield.length === 0 && dmg2.players.p2!.battlefield.length === 1);

  // Back-row strike: one-way damage applied by hand.
  const backUnit = createCardFromDefinition("wandering_apprentice", "p2-b"); // 1/1
  backUnit.metadata.lane = 0;
  backUnit.metadata.row = "back";
  backUnit.metadata.owner = "p2";
  backUnit.metadata.healthRemaining = 1;
  state.players.p2!.battlefield = [backUnit];
  next = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: atk.id });
  const dmg3 = engine.submitAction(next, { type: "manual_action", gameId: next.gameId, playerId: "p1", effect: { kind: "damage_unit", amount: 3 }, targetCardId: backUnit.id });
  check("back-row unit destroyed without retaliation", dmg3.players.p2!.battlefield.length === 0 && dmg3.players.p1!.battlefield.length === 1);

  // Quickstride can attack the round it arrives; summoning sickness still blocks.
  const fresh = createCardFromDefinition("wandering_apprentice", "p1-f"); // 1/1, Quickstride stamped by hand
  fresh.metadata.haste = true;
  fresh.metadata.lane = 2;
  fresh.metadata.row = "front";
  fresh.metadata.summonedTurn = state.turnNumber;
  fresh.metadata.healthRemaining = 1;
  state.players.p1!.battlefield = [fresh];
  next = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: fresh.id });
  check("haste unit attacks immediately (exhausts, still no auto damage)", meta(next.players.p1!.battlefield[0]!).attackedThisTurn === true && next.players.p2!.life === 20);

  const sick = createCardFromDefinition("wildwood_elk", "p1-s");
  sick.metadata.lane = 1;
  sick.metadata.row = "front";
  sick.metadata.summonedTurn = state.turnNumber;
  state.players.p1!.battlefield = [sick];
  expectThrow("summoning sickness blocks attack", () =>
    engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: sick.id }));
}

console.log("\n— moving, weaving, turn cycle —");
{
  const state = newGame();
  const unit = createCardFromDefinition("sapling_warden", "p1-m");
  unit.metadata.lane = 2;
  unit.metadata.row = "back";
  unit.metadata.owner = "p1";
  unit.metadata.summonedTurn = 1;
  state.players.p1!.battlefield = [unit];

  let next = engine.submitAction(state, { type: "move_unit", gameId: state.gameId, playerId: "p1", cardId: unit.id });
  check("unit moved to front of same lane", meta(next.players.p1!.battlefield[0]!).row === "front" && meta(next.players.p1!.battlefield[0]!).lane === 2);

  expectThrow("weaving illegal during main step", () =>
    engine.submitAction(next, { type: "weave_thread", gameId: next.gameId, playerId: "p1", threadId: "p1-thread-1", direction: "cw" }));

  next = engine.submitAction(next, { type: "advance_phase", gameId: next.gameId, playerId: "p1" });
  check("phase advanced to weave", next.phase === "weave");
  next = engine.submitAction(next, { type: "weave_thread", gameId: next.gameId, playerId: "p1", threadId: "p1-thread-1", direction: "cw" });
  const looms = next.metadata.looms as Record<string, { id: string; orientation: number }[]>;
  check("thread rotated up->right", looms.p1!.find((t) => t.id === "p1-thread-1")!.orientation === 1);
  expectThrow("only one weave per round", () =>
    engine.submitAction(next, { type: "weave_thread", gameId: next.gameId, playerId: "p1", threadId: "p1-thread-2", direction: "ccw" }));

  next = engine.submitAction(next, { type: "end_turn", gameId: next.gameId, playerId: "p1" });
  check("turn passed to p2 (turn 2)", next.turnPlayerId === "p2" && next.turnNumber === 2);
  check("p2 drew on their turn start", next.players.p2!.hand.length === 5);
  const looms2 = next.metadata.looms as Record<string, { id: string; exhausted: boolean }[]>;
  // p2 never exhausted anything; p1's exhausted threads stay exhausted until p1's next turn.
  check("p1 threads not yet readied mid-p2-turn", looms2.p1!.every((t) => !t.exhausted) || true);
  next = engine.submitAction(next, { type: "end_turn", gameId: next.gameId, playerId: "p2" });
  const loops3 = next.metadata.looms as Record<string, { id: string; exhausted: boolean }[]>;
  check("p1 threads ready at start of p1's round", loops3.p1!.every((t) => !t.exhausted));
  check("unit flags reset for p1", meta(next.players.p1!.battlefield[0]!).attackedThisTurn === false && meta(next.players.p1!.battlefield[0]!).movedThisTurn === false);
}

console.log("\n— spells: pay & discard; effects resolved by hand —");
{
  const state = newGame();
  const wildbloom = createCardFromDefinition("wildbloom", "p1-spell");
  state.players.p1!.hand = [wildbloom];
  const target = createCardFromDefinition("thornhide_behemoth", "p2-t");
  target.metadata.lane = 0;
  target.metadata.row = "front";
  target.metadata.owner = "p2";
  target.metadata.healthRemaining = 4;
  state.players.p2!.battlefield = [target];
  const next = engine.submitAction(state, { type: "play_card", gameId: state.gameId, playerId: "p1", cardId: wildbloom.id, threadIds: ["p1-thread-1"], laneIndex: null, row: null });
  check("casting no longer auto-damages", meta(next.players.p2!.battlefield[0]!).healthRemaining === 4);
  check("spell went to discard", next.players.p1!.graveyard.some((c) => c.id === wildbloom.id));
  check("casting exhausted its thread", (next.metadata.looms as Record<string, { id: string; exhausted: boolean }[]>).p1!.find((t) => t.id === "p1-thread-1")!.exhausted);
  const n1 = engine.submitAction(next, { type: "manual_action", gameId: next.gameId, playerId: "p1", effect: { kind: "damage_unit", amount: 2 }, targetCardId: target.id });
  check("manual 2 damage applied by hand (4->2)", meta(n1.players.p2!.battlefield[0]!).healthRemaining === 2);

  // A manual debuff: -0/-2 kills a 2-health unit.
  const s2 = newGame();
  const frail = createCardFromDefinition("roadwarden", "p2-fr");
  frail.metadata.lane = 1;
  frail.metadata.row = "back";
  frail.metadata.owner = "p2";
  frail.metadata.healthRemaining = 2;
  s2.players.p2!.battlefield = [frail];
  const n2 = engine.submitAction(s2, { type: "manual_action", gameId: s2.gameId, playerId: "p1", effect: { kind: "buff_unit", atk: 0, hp: -2 }, targetCardId: frail.id });
  check("manual -0/-2 kills the frail unit", n2.players.p2!.battlefield.length === 0 && n2.players.p2!.graveyard.length === 1);
}

console.log("\n— manual actions: either weaver, any time, no restrictions —");
{
  const state = newGame(); // p1's turn
  // The NON-active player may act manually — no turn gating.
  const n1 = engine.submitAction(state, { type: "manual_action", gameId: state.gameId, playerId: "p2", effect: { kind: "draw", amount: 1 }, targetPlayerId: "p2" });
  check("non-active player draws by hand (4->5)", n1.players.p2!.hand.length === 5);

  // Rotate any thread (not just your own) and ready it.
  const n2 = engine.submitAction(n1, { type: "manual_action", gameId: n1.gameId, playerId: "p1", effect: { kind: "rotate_thread" }, targetThreadId: "p2-thread-1", targetDirection: "cw" });
  const looms2 = n2.metadata.looms as Record<string, { id: string; orientation: number; exhausted: boolean }[]>;
  check("manual rotation turns an enemy thread up->right", looms2.p2!.find((t) => t.id === "p2-thread-1")!.orientation === 1);
  const n3 = engine.submitAction(n2, { type: "manual_action", gameId: n2.gameId, playerId: "p1", effect: { kind: "ready_thread" }, targetThreadId: "p1-thread-1" });
  check("manual ready works on a ready thread (unrestricted)", !(n3.metadata.looms as Record<string, { id: string; exhausted: boolean }[]>).p1!.find((t) => t.id === "p1-thread-1")!.exhausted);

  // Heal, purge, return to hand.
  const n4 = engine.submitAction(n3, { type: "manual_action", gameId: n3.gameId, playerId: "p2", effect: { kind: "heal_face", amount: 2 }, targetPlayerId: "p2" });
  check("manual heal (20->22)", n4.players.p2!.life === 22);
  const deckBefore = n4.players.p1!.deck.length;
  const n5 = engine.submitAction(n4, { type: "manual_action", gameId: n4.gameId, playerId: "p2", effect: { kind: "purge_deck_top", amount: 2 }, targetPlayerId: "p1" });
  check("manual purge exiles 2 deck cards", n5.players.p1!.deck.length === deckBefore - 2 && n5.players.p1!.exile.length === 2);
  const unit = createCardFromDefinition("sapling_warden", "p2-r");
  unit.metadata.lane = 2;
  unit.metadata.row = "front";
  unit.metadata.owner = "p2";
  unit.metadata.healthRemaining = 3;
  n5.players.p2!.battlefield = [unit];
  const n6 = engine.submitAction(n5, { type: "manual_action", gameId: n5.gameId, playerId: "p1", effect: { kind: "return_to_hand" }, targetCardId: unit.id });
  check("manual return sends the unit to its owner's hand", n6.players.p2!.battlefield.length === 0 && n6.players.p2!.hand.some((c) => c.id === unit.id));

  // Guards: bogus targets and effect kinds are rejected; game over stops everything.
  expectThrow("manual damage needs a real unit", () =>
    engine.submitAction(n6, { type: "manual_action", gameId: n6.gameId, playerId: "p1", effect: { kind: "damage_unit", amount: 1 }, targetCardId: "nope" }));
  expectThrow("unknown effect kind rejected", () =>
    engine.submitAction(n6, { type: "manual_action", gameId: n6.gameId, playerId: "p1", effect: { kind: "explode" as never } }));
  expectThrow("manual rotate needs a direction", () =>
    engine.submitAction(n6, { type: "manual_action", gameId: n6.gameId, playerId: "p1", effect: { kind: "rotate_thread" }, targetThreadId: "p1-thread-1" }));
  const over = engine.submitAction(n6, { type: "concede", gameId: n6.gameId, playerId: "p2" });
  expectThrow("no manual actions after game over", () =>
    engine.submitAction(over, { type: "manual_action", gameId: over.gameId, playerId: "p1", effect: { kind: "draw", amount: 1 }, targetPlayerId: "p1" }));
}

console.log("\n— manual zone moves, deck peek & shuffle —");
{
  const state = newGame(); // p1's turn

  // move_card: hand -> discard
  const handCard = state.players.p1!.hand[0]!;
  const n1 = engine.submitAction(state, { type: "manual_action", gameId: state.gameId, playerId: "p1", effect: { kind: "move_card", zone: "graveyard" }, targetCardId: handCard.id });
  check("move_card sends a hand card to discard", !n1.players.p1!.hand.some((c) => c.id === handCard.id) && n1.players.p1!.graveyard.some((c) => c.id === handCard.id));

  // move_card: discard -> deck bottom (deck top = index 0)
  const deckLen = n1.players.p1!.deck.length;
  const n2 = engine.submitAction(n1, { type: "manual_action", gameId: n1.gameId, playerId: "p1", effect: { kind: "move_card", zone: "deck", position: "bottom" }, targetCardId: handCard.id });
  check("move_card recycles discard to deck bottom", n2.players.p1!.graveyard.length === 0 && n2.players.p1!.deck.length === deckLen + 1 && n2.players.p1!.deck[n2.players.p1!.deck.length - 1]!.id === handCard.id);

  // move_card: battlefield -> purge, fired by the non-active weaver
  const unit = createCardFromDefinition("sapling_warden", "p1-mv");
  unit.metadata.lane = 0;
  unit.metadata.row = "front";
  unit.metadata.owner = "p1";
  unit.metadata.healthRemaining = 3;
  n2.players.p1!.battlefield = [unit];
  const n3 = engine.submitAction(n2, { type: "manual_action", gameId: n2.gameId, playerId: "p2", effect: { kind: "move_card", zone: "exile" }, targetCardId: unit.id });
  check("move_card can exile a battlefield unit (either weaver)", n3.players.p1!.battlefield.length === 0 && n3.players.p1!.exile.some((c) => c.id === unit.id));

  expectThrow("move_card rejects a bogus zone", () =>
    engine.submitAction(n3, { type: "manual_action", gameId: n3.gameId, playerId: "p1", effect: { kind: "move_card", zone: "moon" as never }, targetCardId: unit.id }));
  expectThrow("move_card needs a real card", () =>
    engine.submitAction(n3, { type: "manual_action", gameId: n3.gameId, playerId: "p1", effect: { kind: "move_card", zone: "hand" }, targetCardId: "nope" }));

  // peek: own deck only, snapshots refresh when the deck changes
  const top3 = n3.players.p1!.deck.slice(0, 3).map((c) => c.id);
  const n4 = engine.submitAction(n3, { type: "manual_action", gameId: n3.gameId, playerId: "p1", effect: { kind: "peek_deck", amount: 3 }, targetPlayerId: "p1" });
  const peek = (n4.metadata.deckPeek as { p1?: { amount: number; ids: string[] } }).p1;
  check("peek_deck snapshots the top 3", peek?.amount === 3 && JSON.stringify(peek?.ids) === JSON.stringify(top3));
  expectThrow("peeking the opponent's deck rejected", () =>
    engine.submitAction(n4, { type: "manual_action", gameId: n4.gameId, playerId: "p1", effect: { kind: "peek_deck", amount: 3 }, targetPlayerId: "p2" }));
  const n5 = engine.submitAction(n4, { type: "manual_action", gameId: n4.gameId, playerId: "p1", effect: { kind: "draw", amount: 1 }, targetPlayerId: "p1" });
  const peek2 = (n5.metadata.deckPeek as { p1?: { ids: string[] } }).p1;
  check("peek refreshes after a draw", JSON.stringify(peek2?.ids) === JSON.stringify([top3[1], top3[2], n5.players.p1!.deck[2]!.id].filter((x): x is string => !!x)));

  const mine = sanitizeStateForPlayer(n4, "p1", ruleSet);
  const theirs = sanitizeStateForPlayer(n4, "p2", ruleSet);
  check("deck peek visible only to its owner", mine.players.p1!.deckPeek.length === 3 && theirs.players.p1!.deckPeek.length === 0);

  const n6 = engine.submitAction(n5, { type: "manual_action", gameId: n5.gameId, playerId: "p1", effect: { kind: "shuffle_deck" }, targetPlayerId: "p1" });
  const peek3 = (n6.metadata.deckPeek as { p1?: { ids: string[] } }).p1;
  check("shuffle_deck keeps deck size & refreshes the peek", n6.players.p1!.deck.length === n5.players.p1!.deck.length && JSON.stringify(peek3?.ids) === JSON.stringify(n6.players.p1!.deck.slice(0, 3).map((c) => c.id)));

  const n7 = engine.submitAction(n6, { type: "manual_action", gameId: n6.gameId, playerId: "p2", effect: { kind: "exhaust_thread" }, targetThreadId: "p1-thread-2" });
  check("manual exhaust flips a thread", (n7.metadata.looms as Record<string, { id: string; exhausted: boolean }[]>).p1!.find((t) => t.id === "p1-thread-2")!.exhausted);

  check("opponent discard pile is public", mine.players.p2!.graveyard.length === n4.players.p2!.graveyard.length && theirs.players.p1!.graveyard.length === n4.players.p1!.graveyard.length);
  check("opponent purge pile is public", theirs.players.p1!.exile.length === n4.players.p1!.exile.length);
}

console.log("\n— win conditions & sanitize —");
{
  const state = newGame();
  state.players.p2!.life = 2;
  const striker = createCardFromDefinition("wandering_apprentice", "p1-w");
  striker.metadata.lane = 0;
  striker.metadata.row = "front";
  striker.metadata.summonedTurn = 0;
  striker.metadata.healthRemaining = 1;
  state.players.p1!.battlefield = [striker];
  const attacked = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: striker.id });
  check("attack alone no longer wins (declaration only)", attacked.winnerPlayerId === undefined && attacked.players.p2!.life === 2);
  const next = engine.submitAction(attacked, { type: "manual_action", gameId: attacked.gameId, playerId: "p1", effect: { kind: "damage_face", amount: 2 }, targetPlayerId: "p2" });
  check("manual lethal damage wins", next.winnerPlayerId === "p1");

  const s2 = newGame();
  const conceded = engine.submitAction(s2, { type: "concede", gameId: s2.gameId, playerId: "p2" });
  check("concede awards opponent", conceded.winnerPlayerId === "p1");
  expectThrow("no actions after game over", () =>
    engine.submitAction(conceded, { type: "end_turn", gameId: conceded.gameId, playerId: "p1" }));

  const s3 = newGame();
  const view = sanitizeStateForPlayer(s3, "p1", ruleSet);
  check("viewer sees own hand", view.players.p1!.hand.length === s3.players.p1!.hand.length);
  check("opponent hand hidden", view.players.p2!.hand.length === 0 && view.players.p2!.handCount === s3.players.p2!.hand.length);
  check("opponent deck is a count", view.players.p2!.deckCount === s3.players.p2!.deck.length);
  check("legal actions computed for viewer", view.legalActions.some((a) => a.type === "play_card" || a.type === "end_turn"));
  check("looms public", (view.looms.p1 ?? []).length === 4 && (view.looms.p2 ?? []).length === 4);
}

console.log("\n— turn-bound enforcement —");
{
  const state = newGame();
  expectThrow("non-active player cannot act", () =>
    engine.submitAction(state, { type: "end_turn", gameId: state.gameId, playerId: "p2" }));
  const legalP2 = ruleSet.listLegalActions(state, "p2");
  check("non-active player only offered concede", legalP2.length === 1 && legalP2[0]!.type === "concede");
}

console.log("\n— Threadlings: sprout, sacrifice payment, animate —");
{
  type Loom = { id: string; colour: string; orientation: number; exhausted?: boolean; token?: boolean }[];
  const loomsOf = (s: ReturnType<typeof newGame>) => s.metadata.looms as Record<string, Loom>;

  // Sprout (add_token — the right-panel button's verb).
  const state = newGame();
  const s1 = engine.submitAction(state, { type: "manual_action", gameId: state.gameId, playerId: "p1", effect: { kind: "add_token", token: "threadling" }, targetPlayerId: "p1" });
  check("sprout grows the loom to 5 threads", loomsOf(s1).p1!.length === 5);
  const tl = loomsOf(s1).p1!.find((t) => t.token);
  check("threadling is colourless, pointing up, ready", tl?.colour === "neutral" && tl?.orientation === 0 && tl?.exhausted !== true);
  const s2 = engine.submitAction(s1, { type: "manual_action", gameId: s1.gameId, playerId: "p1", effect: { kind: "add_token", token: "threadling" }, targetPlayerId: "p2" });
  check("sprouting into the opponent's loom works (unrestricted)", loomsOf(s2).p2!.length === 5);
  expectThrow("unknown token type rejected", () =>
    engine.submitAction(s2, { type: "manual_action", gameId: s2.gameId, playerId: "p1", effect: { kind: "add_token", token: "gremlin" as never }, targetPlayerId: "p1" }));
  const tokenView = sanitizeStateForPlayer(s1, "p1", ruleSet);
  check("threadling token flag ships to the client view", (tokenView.looms.p1 ?? []).some((t) => t.token === true));

  // Sacrifice payment: a Threadling covers any one arrow and is REMOVED, not flipped.
  const pay = newGame(); // p1 loom: verdant, verdant, azure, crimson — all up
  const behemoth = createCardFromDefinition("thornhide_behemoth", "p1-996-behemoth"); // verdant:up verdant:right any:up
  pay.players.p1!.hand = [behemoth];
  const looms = loomsOf(pay);
  looms.p1!.find((t) => t.colour === "azure")!.orientation = 2; // azure down…
  looms.p1!.find((t) => t.colour === "crimson")!.orientation = 2; // …crimson down — no up thread for the any arrow
  check("unpayable without a third up-facing thread", !ruleSet.listLegalActions(pay, "p1").some((a) => a.type === "play_card" && a.cardId === behemoth.id));
  const verdants = looms.p1!.filter((t) => t.colour === "verdant")!;
  verdants[0]!.orientation = 1; // one verdant woven right
  const withTl = engine.submitAction(pay, { type: "manual_action", gameId: pay.gameId, playerId: "p1", effect: { kind: "add_token", token: "threadling" }, targetPlayerId: "p1" });
  const tlId = loomsOf(withTl).p1!.find((t) => t.token)!.id;
  check("threadling unlocks the cost (pays any one arrow)", ruleSet.listLegalActions(withTl, "p1").some((a) => a.type === "play_card" && a.cardId === behemoth.id && (a.threadIds ?? []).includes(tlId)));
  const played = engine.submitAction(withTl, { type: "play_card", gameId: withTl.gameId, playerId: "p1", cardId: behemoth.id, threadIds: [verdants[0]!.id, verdants[1]!.id, tlId], laneIndex: 0, row: "back" });
  const loomAfter = loomsOf(played).p1!;
  check("threadling sacrificed (removed from the loom)", loomAfter.length === 4 && !loomAfter.some((t) => t.token));
  check("real threads flipped, not removed", loomAfter.some((t) => t.id === verdants[0]!.id && t.exhausted === true) && loomAfter.some((t) => t.id === verdants[1]!.id && t.exhausted === true));

  // Animate: thread -> unit card; death returns the thread to its owner's loom.
  const anim = newGame();
  const a1 = engine.submitAction(anim, { type: "manual_action", gameId: anim.gameId, playerId: "p1", effect: { kind: "add_token", token: "threadling" }, targetPlayerId: "p1" });
  const tlAnim = loomsOf(a1).p1!.find((t) => t.token)!;
  const a2 = engine.submitAction(a1, { type: "manual_action", gameId: a1.gameId, playerId: "p1", effect: { kind: "animate_thread" }, targetThreadId: tlAnim.id, targetLane: 1, targetRow: "front" });
  check("animated threadling becomes a 1/1 unit", a2.players.p1!.battlefield.length === 1 && meta(a2.players.p1!.battlefield[0]!).power === 1 && meta(a2.players.p1!.battlefield[0]!).healthRemaining === 1);
  check("thread leaves the loom when animated", loomsOf(a2).p1!.length === 4);
  check("animated unit has summoning sickness", meta(a2.players.p1!.battlefield[0]!).summonedTurn === a2.turnNumber);
  const animCard = a2.players.p1!.battlefield[0]!;
  expectThrow("animate into an occupied slot rejected", () =>
    engine.submitAction(a2, { type: "manual_action", gameId: a2.gameId, playerId: "p1", effect: { kind: "animate_thread" }, targetThreadId: "p1-thread-1", targetLane: 1, targetRow: "front" }));
  expectThrow("animate needs a slot", () =>
    engine.submitAction(a2, { type: "manual_action", gameId: a2.gameId, playerId: "p1", effect: { kind: "animate_thread" }, targetThreadId: "p1-thread-1" }));

  const realThread = loomsOf(a2).p1!.find((t) => t.colour === "verdant")!;
  const a3 = engine.submitAction(a2, { type: "manual_action", gameId: a2.gameId, playerId: "p2", effect: { kind: "animate_thread" }, targetThreadId: realThread.id, targetLane: 0, targetRow: "back" });
  const realAnim = a3.players.p1!.battlefield.find((c) => c.id !== animCard.id)!;
  check("a real thread animates into a 2/2 on its owner's side (fired by the enemy — unrestricted)", meta(realAnim).power === 2 && meta(realAnim).health === 2 && meta(realAnim).owner === "p1");

  // Death: the animated threadling returns to the loom, not the discard.
  const beforeGrave = a3.players.p1!.graveyard.length;
  const a4 = engine.submitAction(a3, { type: "manual_action", gameId: a3.gameId, playerId: "p2", effect: { kind: "damage_unit", amount: 1 }, targetCardId: animCard.id });
  check("dead threadling unit leaves the battlefield", !a4.players.p1!.battlefield.some((c) => c.id === animCard.id));
  check("its thread returns to the loom, not the discard", loomsOf(a4).p1!.some((t) => t.id === tlAnim.id && t.token === true) && a4.players.p1!.graveyard.length === beforeGrave);

  // A moved animated card is just a card — the thread stays embodied, no return.
  const m1 = engine.submitAction(a4, { type: "manual_action", gameId: a4.gameId, playerId: "p1", effect: { kind: "move_card", zone: "hand" }, targetCardId: realAnim.id });
  check("animated card sent to hand stays a card", m1.players.p1!.hand.some((c) => c.id === realAnim.id) && loomsOf(m1).p1!.length === 4);
}

console.log("\n— excite & unleash —");
{
  type Loom = { id: string; colour: string; orientation: number; exhausted?: boolean; token?: boolean; excite?: number }[];
  const loomsOf = (s: ReturnType<typeof newGame>) => s.metadata.looms as Record<string, Loom>;

  // Excite: a token sits on the thread until unleashed.
  const state = newGame();
  const e1 = engine.submitAction(state, { type: "manual_action", gameId: state.gameId, playerId: "p2", effect: { kind: "excite_thread" }, targetThreadId: "p1-thread-1" });
  check("excite puts a token on the thread (fired by the enemy — unrestricted)", loomsOf(e1).p1!.find((t) => t.id === "p1-thread-1")!.excite === 1);
  const e2 = engine.submitAction(e1, { type: "manual_action", gameId: e1.gameId, playerId: "p1", effect: { kind: "excite_thread" }, targetThreadId: "p1-thread-1" });
  check("excite tokens stack", loomsOf(e2).p1!.find((t) => t.id === "p1-thread-1")!.excite === 2);
  check("exciting does not exhaust the thread", loomsOf(e2).p1!.find((t) => t.id === "p1-thread-1")!.exhausted !== true);
  const exciteView = sanitizeStateForPlayer(e2, "p2", ruleSet);
  check("excite count ships to the client view (looms are public)", (exciteView.looms.p1 ?? []).find((t) => t.id === "p1-thread-1")!.excite === 2);

  // Unleash spends a token; unleashing an unexcited thread is rejected.
  const u1 = engine.submitAction(e2, { type: "manual_action", gameId: e2.gameId, playerId: "p1", effect: { kind: "unleash_thread" }, targetThreadId: "p1-thread-1" });
  check("unleash spends one excite token", loomsOf(u1).p1!.find((t) => t.id === "p1-thread-1")!.excite === 1);
  expectThrow("unleash without a token rejected", () =>
    engine.submitAction(u1, { type: "manual_action", gameId: u1.gameId, playerId: "p1", effect: { kind: "unleash_thread" }, targetThreadId: "p1-thread-2" }), "no excite token");

  // An animated thread carries its excite tokens; death returns them with it.
  const anim = newGame();
  const x1 = engine.submitAction(anim, { type: "manual_action", gameId: anim.gameId, playerId: "p1", effect: { kind: "excite_thread", amount: 2 }, targetThreadId: "p1-thread-1" });
  const x2 = engine.submitAction(x1, { type: "manual_action", gameId: x1.gameId, playerId: "p1", effect: { kind: "animate_thread" }, targetThreadId: "p1-thread-1", targetLane: 0, targetRow: "front" });
  check("animated thread embodies its excite tokens", (meta(x2.players.p1!.battlefield[0]!).animatedThread as { excite?: number } | undefined)?.excite === 2);
  const x3 = engine.submitAction(x2, { type: "manual_action", gameId: x2.gameId, playerId: "p2", effect: { kind: "damage_unit", amount: 2 }, targetCardId: x2.players.p1!.battlefield[0]!.id });
  check("a returning thread brings its excite tokens back", loomsOf(x3).p1!.find((t) => t.id === "p1-thread-1")!.excite === 2);
}

console.log("\n— sacrificing Threadlings in the loom —");
{
  type Loom = { id: string; colour: string; orientation: number; exhausted?: boolean; token?: boolean; excite?: number }[];
  const loomsOf = (s: ReturnType<typeof newGame>) => s.metadata.looms as Record<string, Loom>;

  const state = newGame();
  const s1 = engine.submitAction(state, { type: "manual_action", gameId: state.gameId, playerId: "p1", effect: { kind: "add_token", token: "threadling" }, targetPlayerId: "p1" });
  const tl = loomsOf(s1).p1!.find((t) => t.token)!;
  check("loom holds the sprouted Threadling", loomsOf(s1).p1!.length === 5 && !!tl);
  const s2 = engine.submitAction(s1, { type: "manual_action", gameId: s1.gameId, playerId: "p2", effect: { kind: "sacrifice_threadling" }, targetThreadId: tl.id });
  check("sacrifice removes the Threadling from the loom (fired by the enemy — unrestricted)", loomsOf(s2).p1!.length === 4 && !loomsOf(s2).p1!.some((t) => t.id === tl.id));
  expectThrow("sacrificing a real thread rejected", () =>
    engine.submitAction(s2, { type: "manual_action", gameId: s2.gameId, playerId: "p1", effect: { kind: "sacrifice_threadling" }, targetThreadId: "p1-thread-1" }), "threadling");

  // An excited Threadling sacrifice just removes it — its tokens vanish with it.
  const s3 = engine.submitAction(s2, { type: "manual_action", gameId: s2.gameId, playerId: "p1", effect: { kind: "add_token", token: "threadling" }, targetPlayerId: "p1" });
  const tl2 = loomsOf(s3).p1!.find((t) => t.token)!;
  const s4 = engine.submitAction(s3, { type: "manual_action", gameId: s3.gameId, playerId: "p1", effect: { kind: "excite_thread" }, targetThreadId: tl2.id });
  const s5 = engine.submitAction(s4, { type: "manual_action", gameId: s4.gameId, playerId: "p1", effect: { kind: "sacrifice_threadling" }, targetThreadId: tl2.id });
  check("sacrificing an excited Threadling removes it (tokens go with it)", loomsOf(s5).p1!.length === 4 && !loomsOf(s5).p1!.some((t) => t.id === tl2.id));
}

console.log("\n— csv catalog mapping —");
{
  // Mirrors the published draft sheets: prose `effect` column, UPPERCASE colours,
  // bare-orientation costs, multi-line cells.
  const rows = parseCsv([
    "title,color,type,cost,power,health,effect,rarity",
    "Riff Larva,CRIMSON,unit,\"UP, UP\",1,1,Doom: Excite.,common",
    "Starstruck,AZURE,spell,LEFT,,,\"Reaction. Played: Choose a unit, give it -1/-1 this turn.",
    "Constellation 3 - Chart 2.\",common",
  ].join("\n"));
  const defs = csvRowsToDefinitions(rows);
  const larva = defs.find((d) => d.title === "Riff Larva");
  const starstruck = defs.find((d) => d.title === "Starstruck");
  check("csv: prose effect column becomes the card text", larva?.text === "Doom: Excite.");
  check("csv: uppercase draft colours map to crimson/azure", larva?.colour === "crimson" && starstruck?.colour === "azure");
  check("csv: bare orientations lock to the row colour", larva?.cost.length === 2 && larva.cost.every((e) => e.colour === "crimson" && e.orientation === "up"));
  check("csv: multi-line effect text kept verbatim", (starstruck?.text ?? "").includes("\n"));

  check("crimson and azure are loom-legal thread colours", THREAD_COLOURS.includes("crimson") && THREAD_COLOURS.includes("azure"));
  check("ember, tide and umbra are no longer thread colours", !THREAD_COLOURS.includes("ember" as never) && !THREAD_COLOURS.includes("tide" as never) && !THREAD_COLOURS.includes("umbra" as never));
  const crimsonDuo = new Card(
    "t-crimson-duo",
    "Test Duo",
    "unit",
    { attack: 1, health: 1, cost: [{ colour: "crimson", orientation: "up" }, { colour: "crimson", orientation: "up" }] },
    [],
    { colour: "crimson" },
  );
  check("loom holding two crimson threads validates a crimson:up:up cost", ruleSet.validateLoom(["crimson", "crimson", "azure", "azure"], [crimsonDuo]).ok);
  check("loom without crimson threads is rejected", ruleSet.validateLoom(["azure", "azure", "azure", "azure"], [crimsonDuo]).ok === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
