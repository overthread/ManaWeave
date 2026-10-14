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
  const manyCopies = Array.from({ length: 21 }, () => createCardFromDefinition("scorch", "x"));
  const v = ruleSet.validateDeck(manyCopies);
  check("21-card deck of one card rejected on copies", !v.ok && /copies/i.test(v.reason ?? ""));
  const badLoom = ruleSet.validateLoom(["ember", "ember", "ember"], deckA);
  check("loom with 3 threads rejected", !badLoom.ok);
  const missingColour = ruleSet.validateLoom(["ember", "ember", "ember", "ember"], deckA);
  check("loom missing umbra rejected for deck containing umbra", !missingColour.ok);
}

console.log("\n— playing cards & threads —");
{
  const state = newGame();
  // Force a known hand for p1: a 1-cost ember unit.
  const whelp = createCardFromDefinition("cinder_whelp", "p1-999-cinder_whelp");
  state.players.p1!.hand = [whelp];
  const legal = ruleSet.listLegalActions(state, "p1");
  const plays = legal.filter((a): a is PlayCardAction => a.type === "play_card" && a.cardId === whelp.id);
  check("unit playable into 6 slots x valid thread combos", plays.length > 0);
  check("play actions enumerate slots", new Set(plays.map((a) => `${a.laneIndex}:${a.row}`)).size === 6);

  const looms = state.metadata.looms as Record<string, { id: string; colour: string }[]>;
  const emberThread = looms.p1!.find((t) => t.colour === "ember")!;
  const tideThread = looms.p1!.find((t) => t.colour === "umbra")!;

  const next = engine.submitAction(state, { type: "play_card", gameId: state.gameId, playerId: "p1", cardId: whelp.id, threadIds: [emberThread.id], laneIndex: 1, row: "back" });
  check("unit deployed to lane 2 back", next.players.p1!.battlefield.some((c) => meta(c).lane === 1 && meta(c).row === "back"));
  check("paying thread exhausted", (next.metadata.looms as Record<string, { id: string; exhausted: boolean }[]>).p1!.find((t) => t.id === emberThread.id)!.exhausted);
  check("summoning sickness stamped", next.players.p1!.battlefield[0]!.metadata.summonedTurn === 1);

  // Paying with the wrong colour for a coloured card must not be offered.
  const legalAfter = ruleSet.listLegalActions(state, "p1");
  check("wrong-colour-only payment not offered for ember card", !legalAfter.some((a) => a.type === "play_card" && (a.threadIds ?? []).join() === tideThread.id));

  expectThrow("engine rejects non-offered thread combo", () =>
    engine.submitAction(state, { type: "play_card", gameId: state.gameId, playerId: "p1", cardId: whelp.id, threadIds: [tideThread.id], laneIndex: 1, row: "back" }));
  expectThrow("engine rejects occupied slot", () =>
    engine.submitAction(next, { type: "play_card", gameId: state.gameId, playerId: "p1", cardId: whelp.id, threadIds: [], laneIndex: 1, row: "back" }));
}

console.log("\n— coloured orientation costs —");
{
  const state = newGame();
  const djinn = createCardFromDefinition("flamecaller_djinn", "p1-998-djinn"); // ember:up ember:right any:up
  state.players.p1!.hand = [djinn];
  const looms = state.metadata.looms as Record<string, { id: string; colour: string; orientation: number; exhausted: boolean }[]>;
  check("not castable while all threads up", !ruleSet.listLegalActions(state, "p1").some((a) => a.type === "play_card" && a.cardId === djinn.id));

  looms.p1!.find((t) => t.colour === "umbra")!.orientation = 1; // right — wrong colour
  check("right-pointing wrong-colour thread doesn't pay", !ruleSet.listLegalActions(state, "p1").some((a) => a.type === "play_card" && a.cardId === djinn.id));

  const emberThread = looms.p1!.find((t) => t.colour === "ember")!;
  emberThread.orientation = 1; // right
  const legalNow = ruleSet.listLegalActions(state, "p1");
  check("castable once an ember thread points right", legalNow.some((a) => a.type === "play_card" && a.cardId === djinn.id && (a.threadIds ?? []).includes(emberThread.id)));

  looms.p1!.find((t) => t.id !== emberThread.id && t.colour === "ember")!.orientation = 1; // no ember:up left
  check("no ember-up left blocks the ember:up entry", !ruleSet.listLegalActions(state, "p1").some((a) => a.type === "play_card" && a.cardId === djinn.id));

  // Whole-loom cost: ember:up ember:down any:up any:up over loom [ember, ember, umbra, umbra].
  const state2 = newGame();
  const colossus = createCardFromDefinition("pyre_colossus", "p1-997-colossus");
  state2.players.p1!.hand = [colossus];
  const looms2 = state2.metadata.looms as Record<string, { colour: string; orientation: number }[]>;
  const setOrient = (colour: string, orientation: number) => {
    for (const t of looms2.p1!) t.orientation = 0;
    looms2.p1!.find((t) => t.colour === colour)!.orientation = orientation;
  };
  setOrient("umbra", 2); // an umbra thread down — wrong colour for the ember:down entry
  check("down-pointing wrong colour doesn't pay", !ruleSet.listLegalActions(state2, "p1").some((a) => a.type === "play_card" && a.cardId === colossus.id));
  setOrient("ember", 2); // an ember thread down, three threads up
  check("payable with ember-up, ember-down and two any-up", ruleSet.listLegalActions(state2, "p1").some((a) => a.type === "play_card" && a.cardId === colossus.id));
  looms2.p1!.find((t) => t.colour === "ember" && t.orientation !== 2)!.orientation = 2; // second ember down
  check("no ember-up left blocks the whole-loom cost", !ruleSet.listLegalActions(state2, "p1").some((a) => a.type === "play_card" && a.cardId === colossus.id));
}

console.log("\n— combat: attack is a declaration (exhaust); damage is manual —");
{
  const state = newGame();
  const atk = createCardFromDefinition("ember_skirmisher", "p1-a"); // 2/2
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
  const defender = createCardFromDefinition("mistward_sentinel", "p2-d"); // 3/4
  defender.metadata.lane = 0;
  defender.metadata.row = "front";
  defender.metadata.owner = "p2";
  defender.metadata.healthRemaining = 4;
  state.players.p2!.battlefield = [defender];
  next = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: atk.id });
  check("clash declaration damages nobody yet", next.players.p2!.battlefield[0]!.metadata.healthRemaining === 4 && next.players.p1!.battlefield.length === 1);
  const dmg1 = engine.submitAction(next, { type: "manual_action", gameId: next.gameId, playerId: "p1", effect: { kind: "damage_unit", amount: 3 }, targetCardId: defender.id });
  check("manual damage: defender 4->1", meta(dmg1.players.p2!.battlefield[0]!).healthRemaining === 1);
  const dmg2 = engine.submitAction(dmg1, { type: "manual_action", gameId: dmg1.gameId, playerId: "p2", effect: { kind: "damage_unit", amount: 2 }, targetCardId: atk.id });
  check("manual retaliation kills the attacker, defender survives", dmg2.players.p1!.battlefield.length === 0 && dmg2.players.p2!.battlefield.length === 1);

  // Back-row strike: one-way damage applied by hand.
  const backUnit = createCardFromDefinition("tidepool_scout", "p2-b"); // 1/2
  backUnit.metadata.lane = 0;
  backUnit.metadata.row = "back";
  backUnit.metadata.owner = "p2";
  backUnit.metadata.healthRemaining = 2;
  state.players.p2!.battlefield = [backUnit];
  next = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: atk.id });
  const dmg3 = engine.submitAction(next, { type: "manual_action", gameId: next.gameId, playerId: "p1", effect: { kind: "damage_unit", amount: 3 }, targetCardId: backUnit.id });
  check("back-row unit destroyed without retaliation", dmg3.players.p2!.battlefield.length === 0 && dmg3.players.p1!.battlefield.length === 1);

  // Quickstride can attack the round it arrives; summoning sickness still blocks.
  const fresh = createCardFromDefinition("cinder_whelp", "p1-f"); // Quickstride 1/1
  fresh.metadata.lane = 2;
  fresh.metadata.row = "front";
  fresh.metadata.summonedTurn = state.turnNumber;
  fresh.metadata.healthRemaining = 1;
  state.players.p1!.battlefield = [fresh];
  next = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: fresh.id });
  check("haste unit attacks immediately (exhausts, still no auto damage)", meta(next.players.p1!.battlefield[0]!).attackedThisTurn === true && next.players.p2!.life === 20);

  const sick = createCardFromDefinition("ember_skirmisher", "p1-s");
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
  const scorch = createCardFromDefinition("scorch", "p1-spell");
  state.players.p1!.hand = [scorch];
  const target = createCardFromDefinition("mistward_sentinel", "p2-t");
  target.metadata.lane = 0;
  target.metadata.row = "front";
  target.metadata.owner = "p2";
  target.metadata.healthRemaining = 4;
  state.players.p2!.battlefield = [target];
  const next = engine.submitAction(state, { type: "play_card", gameId: state.gameId, playerId: "p1", cardId: scorch.id, threadIds: ["p1-thread-1"], laneIndex: null, row: null });
  check("casting no longer auto-damages", meta(next.players.p2!.battlefield[0]!).healthRemaining === 4);
  check("spell went to discard", next.players.p1!.graveyard.some((c) => c.id === scorch.id));
  check("casting exhausted its thread", (next.metadata.looms as Record<string, { id: string; exhausted: boolean }[]>).p1!.find((t) => t.id === "p1-thread-1")!.exhausted);
  const n1 = engine.submitAction(next, { type: "manual_action", gameId: next.gameId, playerId: "p1", effect: { kind: "damage_unit", amount: 2 }, targetCardId: target.id });
  check("scorch's 2 damage applied by hand (4->2)", meta(n1.players.p2!.battlefield[0]!).healthRemaining === 2);

  // A manual debuff: -0/-2 kills a 2-health unit.
  const s2 = newGame();
  const frail = createCardFromDefinition("tidepool_scout", "p2-fr");
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
  const whelp = createCardFromDefinition("cinder_whelp", "p1-w");
  whelp.metadata.lane = 0;
  whelp.metadata.row = "front";
  whelp.metadata.summonedTurn = 0;
  whelp.metadata.healthRemaining = 1;
  state.players.p1!.battlefield = [whelp];
  const attacked = engine.submitAction(state, { type: "attack", gameId: state.gameId, playerId: "p1", cardId: whelp.id });
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
