/**
 * Battle screen orchestrator: renders from the last pushed view and owns the
 * interaction flows (casting with thread payment, attacking, moving, weaving,
 * manual effect resolution). Commands are matched against `view.legalActions`
 * exactly — the server has the final say on legality. Manual actions are the
 * exception by design: unrestricted, either weaver, any time.
 */
import { createCardEl } from "./card-ui.js";
import { createThreadEl } from "./loom-ui.js";
import { buildBattlefield } from "./battlefield-ui.js";
import { COLOURS, formatCostHtml, formatCostText } from "./shared.js";

const $ = (id) => document.getElementById(id);

const UNIT_TOOLS = ["damage_unit", "buff_unit", "return_to_hand", "destroy_unit"];
const THREAD_TOOLS = ["ready_thread", "rotate_thread"];

export function createGameView(deps) {
  const { submitAction } = deps;

  let view = null;
  let cast = null; // { cardId, threads: Set<string> } while casting a hand card
  let weavePending = null; // { threadId } while choosing a weave direction
  let manual = null; // { kind, label } while a manual tool awaits its target
  let manualRotate = null; // { threadId } while choosing a manual rotation direction
  const manualInputs = { amount: 1, atk: 1, hp: 1 }; // kept across re-renders
  let snapshotKey = "";

  const enemyIdOf = (v) => Object.keys(v.players).find((id) => id !== v.you);
  const myTurn = () => view && view.turnPlayerId === view.you && !view.winnerPlayerId;

  const actions = (type) => (view?.legalActions ?? []).filter((a) => a.type === type);
  const playActionsFor = (cardId) => actions("play_card").filter((a) => a.cardId === cardId);
  const sortedThreads = (ids) => [...ids].sort().join(",");
  const manualUnitTargeting = () => !!manual && UNIT_TOOLS.includes(manual.kind);
  const manualThreadTargeting = () => !!manual && THREAD_TOOLS.includes(manual.kind);

  function findExactPlay(cardId, threads, extra) {
    return playActionsFor(cardId).find(
      (a) =>
        sortedThreads(a.threadIds ?? []) === sortedThreads(threads) &&
        (a.laneIndex ?? null) === (extra.laneIndex ?? null) &&
        (a.row ?? null) === (extra.row ?? null) &&
        (a.targetCardId ?? null) === (extra.targetCardId ?? null) &&
        (a.targetThreadId ?? null) === (extra.targetThreadId ?? null) &&
        (a.targetDirection ?? null) === (extra.targetDirection ?? null),
    );
  }

  function autoThreads(cardId, extra = {}) {
    const match = playActionsFor(cardId).find(
      (a) =>
        (extra.laneIndex === undefined || (a.laneIndex ?? null) === (extra.laneIndex ?? null)) &&
        (extra.row === undefined || (a.row ?? null) === (extra.row ?? null)) &&
        (extra.targetCardId === undefined || (a.targetCardId ?? null) === (extra.targetCardId ?? null)) &&
        (extra.targetThreadId === undefined || (a.targetThreadId ?? null) === (extra.targetThreadId ?? null)),
    );
    return match ? [...(match.threadIds ?? [])] : [];
  }

  function castingCard() {
    if (!cast || !view) return null;
    return view.players[view.you]?.hand.find((c) => c.id === cast.cardId) ?? null;
  }

  // ------------------------------------------------------------ flows

  async function submit(partial) {
    await submitAction(partial);
    cast = null;
    weavePending = null;
    manual = null;
    manualRotate = null;
  }

  async function submitManual(effect, extra = {}) {
    await submit({ type: "manual_action", effect, ...extra });
  }

  /** Arm a manual tool: unit/thread clicks now apply it. Cancels any casting flow. */
  function armManual(kind, label) {
    cast = null;
    weavePending = null;
    manualRotate = null;
    manual = { kind, label };
    render();
  }

  function startCasting(card) {
    if (!myTurn() || view.phase !== "main") return;
    const acts = playActionsFor(card.id);
    if (acts.length === 0) return;
    cast = { cardId: card.id, threads: new Set(autoThreads(card.id)) };
    manual = null;
    manualRotate = null;
    render();
  }

  async function submitPlay(extra) {
    if (!cast) return;
    const card = castingCard();
    if (!card) {
      cast = null;
      render();
      return;
    }
    let action = findExactPlay(card.id, [...cast.threads], extra);
    if (!action) {
      const auto = autoThreads(card.id, extra);
      action = findExactPlay(card.id, auto, extra);
    }
    if (!action) {
      deps.toast("Those threads can't pay for that — adjust your thread picks.");
      render();
      return;
    }
    await submit({ type: "play_card", cardId: card.id, threadIds: action.threadIds, ...extra });
  }

  function togglePaymentThread(threadId) {
    if (!cast) return;
    const card = castingCard();
    if (!card) return;
    const need = card.cost?.length ?? 0;
    if (cast.threads.has(threadId)) cast.threads.delete(threadId);
    else if (cast.threads.size < need) cast.threads.add(threadId);
    else deps.toast(`This card costs ${formatCostText(card.cost)} — one thread per arrow, matching colour and direction.`);
    render();
  }

  // ------------------------------------------------------------ renders

  function renderBars() {
    const enemyId = enemyIdOf(view);
    const me = view.players[view.you];
    const enemy = view.players[enemyId];

    const bar = (p, isMe) => {
      const el = document.createElement("div");
      el.className = "player-bar";
      const flag = view.turnPlayerId === p.id && !view.winnerPlayerId ? `<span class="turn-flag">● weaving now</span>` : "";
      el.innerHTML = `
        <span class="pname">${p.name}${isMe ? " (you)" : ""}</span>
        <span class="life" title="life">${p.life} ❤</span>
        ${flag}
        <span class="spacer" style="flex:1"></span>
        <span class="zone">hand ${p.handCount}</span>
        <span class="zone">deck ${p.deckCount}</span>
        <span class="zone">discard ${p.graveyardCount}</span>
        <span class="zone">purge ${p.exileCount}</span>`;
      return el;
    };

    const enemyBar = $("enemy-bar");
    enemyBar.replaceChildren(bar(enemy, false));
    const myBar = $("my-bar");
    myBar.replaceChildren(bar(me, true));
  }

  async function pickManualThread(t) {
    if (!manual) return;
    if (manual.kind === "ready_thread") {
      await submitManual({ kind: "ready_thread" }, { targetThreadId: t.id });
    } else if (manual.kind === "rotate_thread") {
      manualRotate = { threadId: t.id };
      render();
    }
  }

  function renderLooms() {
    const enemyId = enemyIdOf(view);
    const myLoom = view.looms[view.you] ?? [];
    const enemyLoom = view.looms[enemyId] ?? [];
    const threadTool = manualThreadTargeting();

    const enemyBox = $("enemy-loom");
    enemyBox.replaceChildren();
    const enemyLabel = document.createElement("span");
    enemyLabel.className = "loom-label";
    enemyLabel.textContent = "their loom";
    enemyBox.appendChild(enemyLabel);
    for (const t of enemyLoom) {
      const el = createThreadEl(t, { clickable: threadTool, highlightTarget: threadTool });
      if (threadTool) el.addEventListener("click", () => void pickManualThread(t));
      enemyBox.appendChild(el);
    }

    const myBox = $("my-loom");
    myBox.replaceChildren();
    const myLabel = document.createElement("span");
    myLabel.className = "loom-label";
    myLabel.textContent = "your loom";
    myBox.appendChild(myLabel);

    const weaveActive = myTurn() && view.phase === "weave" && !threadTool && actions("weave_thread").length > 0;
    const payingActive = myTurn() && view.phase === "main" && !!cast && !threadTool;

    for (const t of myLoom) {
      const opts = {
        clickable: (payingActive && !t.exhausted) || weaveActive || threadTool,
        paymentSelectable: payingActive && !t.exhausted,
        paying: cast?.threads.has(t.id) ?? false,
        highlightTarget: threadTool || (weaveActive && weavePending?.threadId === t.id),
      };
      const el = createThreadEl(t, opts);
      el.addEventListener("click", async () => {
        if (threadTool) {
          await pickManualThread(t);
          return;
        }
        if (!myTurn()) return;
        if (payingActive && !t.exhausted) {
          togglePaymentThread(t.id);
          return;
        }
        if (weaveActive) {
          weavePending = { threadId: t.id };
          render();
        }
      });
      myBox.appendChild(el);
    }
  }

  function renderBattlefield() {
    const enemyId = enemyIdOf(view);
    const card = castingCard();
    const isUnitCast = !!card && card.type === "unit";
    const manualUnit = manualUnitTargeting();
    // A manual unit tool targets ANY unit on either side; casting no longer
    // targets (spell effects are resolved by hand after the cast).
    const unitTargets = new Set(
      manualUnit ? Object.values(view.players).flatMap((p) => p.battlefield.map((u) => u.id)) : [],
    );

    const grid = buildBattlefield({
      view,
      enemyId,
      myId: view.you,
      isSlotActive: (lane, row) => !manualUnit && isUnitCast && playActionsFor(cast.cardId).some((a) => a.laneIndex === lane && a.row === row),
      isUnitTarget: (unit) => unitTargets.has(unit.id),
      isUnitClickable: (unit) => {
        if (manualUnit) return true;
        if (unit.owner === view.you && myTurn() && view.phase === "main" && !cast) {
          if (unit.row === "back") return actions("move_unit").some((a) => a.cardId === unit.id);
        }
        return false;
      },
      canAttackUnit: (unit) =>
        unit.owner === view.you &&
        unit.row === "front" &&
        myTurn() &&
        view.phase === "main" &&
        !cast &&
        !manualUnit &&
        actions("attack").some((a) => a.cardId === unit.id),
      onSlotClick: async (lane, row) => {
        if (!cast) return;
        await submitPlay({ laneIndex: lane, row });
      },
      onAttackClick: async (unit) => {
        await submit({ type: "attack", cardId: unit.id });
      },
      onUnitClick: async (unit) => {
        if (manualUnit) {
          if (manual.kind === "damage_unit") await submitManual({ kind: "damage_unit", amount: manualInputs.amount }, { targetCardId: unit.id });
          else if (manual.kind === "buff_unit") await submitManual({ kind: "buff_unit", atk: manualInputs.atk, hp: manualInputs.hp }, { targetCardId: unit.id });
          else await submitManual({ kind: manual.kind }, { targetCardId: unit.id });
          return;
        }
        if (!myTurn() || view.phase !== "main" || cast) return;
        if (unit.owner !== view.you) return;
        if (unit.row === "back" && actions("move_unit").some((a) => a.cardId === unit.id)) {
          await submit({ type: "move_unit", cardId: unit.id });
        }
      },
    });
    $("battlefield").replaceWith(grid);
  }

  function renderHand() {
    const hand = $("hand");
    hand.replaceChildren();
    const me = view.players[view.you];
    const playable = new Set(actions("play_card").map((a) => a.cardId));
    for (const card of me?.hand ?? []) {
      const isPlayable = playable.has(card.id) && myTurn() && view.phase === "main";
      const el = createCardEl(card, {
        clickable: isPlayable,
        playable: isPlayable,
        selected: cast?.cardId === card.id,
      });
      el.addEventListener("click", () => {
        if (cast?.cardId === card.id) {
          cast = null;
          render();
          return;
        }
        startCasting(card);
      });
      hand.appendChild(el);
    }
    if ((me?.hand ?? []).length === 0) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "hand empty";
      hand.appendChild(empty);
    }
  }

  function renderControls() {
    const box = $("controls");
    box.replaceChildren();
    const phasePill = document.createElement("span");
    phasePill.className = "phase-pill";
    phasePill.textContent = view.phase === "main" ? "main step" : "weave step";
    box.appendChild(phasePill);

    const round = document.createElement("span");
    round.className = "turn-note";
    round.textContent = view.winnerPlayerId ? "match finished" : myTurn() ? "your round — act in any order" : `${view.players[view.turnPlayerId]?.name}'s round…`;
    box.appendChild(round);

    if (myTurn()) {
      if (view.phase === "main") {
        const weaveBtn = document.createElement("button");
        weaveBtn.textContent = "Weave Step →";
        weaveBtn.addEventListener("click", () => void submit({ type: "advance_phase" }));
        box.appendChild(weaveBtn);
      }
      const endBtn = document.createElement("button");
      endBtn.className = "primary";
      endBtn.textContent = "End Round";
      endBtn.addEventListener("click", () => void submit({ type: "end_turn" }));
      box.appendChild(endBtn);
    }
  }

  function renderCastingBar() {
    const bar = $("casting-bar");
    bar.replaceChildren();

    // Manual rotate tool: a thread is picked, now choose the direction.
    if (manualRotate) {
      bar.classList.add("visible");
      bar.innerHTML = `<span><b>Manual:</b> rotate the thread which way?</span>`;
      const cw = document.createElement("button");
      cw.textContent = "↻ clockwise";
      cw.addEventListener("click", () =>
        void submitManual({ kind: "rotate_thread" }, { targetThreadId: manualRotate.threadId, targetDirection: "cw" }));
      const ccw = document.createElement("button");
      ccw.textContent = "↺ counter-clockwise";
      ccw.addEventListener("click", () =>
        void submitManual({ kind: "rotate_thread" }, { targetThreadId: manualRotate.threadId, targetDirection: "ccw" }));
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        manualRotate = null;
        render();
      });
      bar.append(cw, ccw, cancel);
      return;
    }

    // Armed manual tool waiting for its target.
    if (manual) {
      bar.classList.add("visible");
      const what = manualThreadTargeting() ? "click a thread on either loom" : "click a unit on the battlefield";
      const amountNote =
        manual.kind === "damage_unit" ? ` (${manualInputs.amount} damage)` : manual.kind === "buff_unit" ? ` (+${manualInputs.atk}/+${manualInputs.hp})` : "";
      bar.innerHTML = `<span><b>Manual:</b> ${manual.label}${amountNote} — ${what}.</span>`;
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        manual = null;
        render();
      });
      bar.appendChild(cancel);
      return;
    }

    const card = castingCard();

    if (weavePending && !card) {
      const t = (view.looms[view.you] ?? []).find((x) => x.id === weavePending.threadId);
      bar.classList.add("visible");
      bar.innerHTML = `<span>Weaving <b>${t ? COLOURS[t.colour].label : "?"}</b> thread — choose a direction:</span>`;
      const cw = document.createElement("button");
      cw.textContent = "↻ clockwise";
      cw.addEventListener("click", () => void submit({ type: "weave_thread", threadId: weavePending.threadId, direction: "cw" }));
      const ccw = document.createElement("button");
      ccw.textContent = "↺ counter-clockwise";
      ccw.addEventListener("click", () => void submit({ type: "weave_thread", threadId: weavePending.threadId, direction: "ccw" }));
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => {
        weavePending = null;
        render();
      });
      bar.append(cw, ccw, cancel);
      return;
    }

    if (!card) {
      bar.classList.remove("visible");
      return;
    }

    bar.classList.add("visible");
    const needsSlot = card.type === "unit";

    const need = card.cost?.length ?? 0;
    let hint = `Exhaust threads matching <b>${formatCostHtml(card.cost)}</b> — one per arrow, right colour and direction. `;
    hint += needsSlot ? "Then click a free slot on your side. " : "Then cast — resolve its effect by hand. ";

    const info = document.createElement("span");
    info.innerHTML = `<b>${card.name}</b> — ${hint}(threads: ${cast.threads.size}/${need})`;
    bar.appendChild(info);

    if (!needsSlot) {
      const castBtn = document.createElement("button");
      castBtn.className = "primary";
      castBtn.textContent = "Cast";
      castBtn.addEventListener("click", () => void submitPlay({}));
      bar.appendChild(castBtn);
    }
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      cast = null;
      render();
    });
    bar.appendChild(cancel);
  }

  /** Manual effect tools: unrestricted — either weaver, any time, no turn gating. */
  function renderManualPanel() {
    const box = $("manual-panel");
    box.replaceChildren();
    const enemyId = enemyIdOf(view);
    const enemy = view.players[enemyId];
    const done = !!view.winnerPlayerId;

    const hint = document.createElement("div");
    hint.className = "manual-hint";
    hint.textContent = "Resolve card effects & combat by hand — either weaver, any time.";
    box.appendChild(hint);

    const row = () => {
      const r = document.createElement("div");
      r.className = "manual-row";
      box.appendChild(r);
      return r;
    };
    const num = (key, min) => {
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(min);
      input.step = "1";
      input.value = String(manualInputs[key]);
      input.title = key === "amount" ? "amount" : key === "atk" ? "attack bonus (may be negative)" : "health bonus (may be negative)";
      input.addEventListener("input", () => {
        manualInputs[key] = Math.trunc(input.valueAsNumber) || 0;
      });
      return input;
    };
    const toolBtn = (label, kind, title) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.disabled = done;
      if (manual?.kind === kind) b.classList.add("armed");
      b.addEventListener("click", () => armManual(kind, label));
      return b;
    };
    const amount = () => Math.max(0, manualInputs.amount);
    const faceBtn = (label, buildEffect, targetPlayerId, title) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.title = title;
      b.disabled = done;
      b.addEventListener("click", () => void submitManual(buildEffect(), { targetPlayerId }));
      return b;
    };
    const you = () => view.you;

    let r = row();
    r.append(document.createTextNode("amount "), num("amount", 1));

    r = row();
    r.append(toolBtn("⚔ damage unit", "damage_unit", "then click a unit"));

    r = row();
    r.append(
      document.createTextNode("💥 dmg weaver "),
      faceBtn("you", () => ({ kind: "damage_face", amount: amount() }), you(), "deal the amount to your weaver"),
      faceBtn(enemy?.name ?? "them", () => ({ kind: "damage_face", amount: amount() }), enemyId, "deal the amount to the enemy weaver"),
    );

    r = row();
    r.append(
      document.createTextNode("❤ heal weaver "),
      faceBtn("you", () => ({ kind: "heal_face", amount: amount() }), you(), "heal your weaver by the amount"),
      faceBtn(enemy?.name ?? "them", () => ({ kind: "heal_face", amount: amount() }), enemyId, "heal the enemy weaver by the amount"),
    );

    r = row();
    r.append(document.createTextNode("✎ alter unit "), num("atk", -99), num("hp", -99), toolBtn("→", "buff_unit", `apply +${manualInputs.atk}/+${manualInputs.hp} to a unit`));

    r = row();
    r.append(
      document.createTextNode("🃏 draw "),
      faceBtn("you", () => ({ kind: "draw", amount: amount() }), you(), "you draw the amount"),
      faceBtn(enemy?.name ?? "them", () => ({ kind: "draw", amount: amount() }), enemyId, "the enemy weaver draws the amount"),
    );

    r = row();
    r.append(
      document.createTextNode("🗑 purge deck "),
      faceBtn("you", () => ({ kind: "purge_deck_top", amount: amount() }), you(), "purge the amount from your deck"),
      faceBtn(enemy?.name ?? "them", () => ({ kind: "purge_deck_top", amount: amount() }), enemyId, "purge the amount from the enemy deck"),
    );

    r = row();
    r.append(toolBtn("↑ ready thread", "ready_thread", "then click a thread on either loom"));

    r = row();
    r.append(toolBtn("⟲ rotate thread", "rotate_thread", "then click a thread, then pick a direction"));

    r = row();
    r.append(toolBtn("⤴ return to hand", "return_to_hand", "then click a unit"));

    r = row();
    r.append(toolBtn("☠ destroy unit", "destroy_unit", "then click a unit"));
  }

  function renderLog() {
    const box = $("log");
    box.replaceChildren();
    for (const entry of view.log ?? []) {
      const line = document.createElement("div");
      line.className = "entry";
      line.textContent = entry;
      box.appendChild(line);
    }
    box.scrollTop = box.scrollHeight;
  }

  function renderWinner() {
    const overlay = $("winner-overlay");
    if (!view.winnerPlayerId) {
      overlay.classList.remove("visible");
      return;
    }
    overlay.classList.add("visible");
    const winner = view.players[view.winnerPlayerId];
    $("winner-text").textContent = `${winner?.name ?? view.winnerPlayerId} wins the weave`;
  }

  function render() {
    if (!view) return;
    $("header-round").textContent = `round ${view.roundNumber} · turn ${view.turnNumber}`;
    $("header-turn").textContent = view.turnPlayerId === view.you ? "your turn" : "opponent's turn";
    renderBars();
    renderLooms();
    renderBattlefield();
    renderControls();
    renderCastingBar();
    renderManualPanel();
    renderHand();
    renderLog();
    renderWinner();
  }

  function resetSelections() {
    cast = null;
    weavePending = null;
    manual = null;
    manualRotate = null;
  }

  return {
    render(nextView) {
      const key = `${nextView.gameId}:${nextView.turnNumber}:${nextView.turnPlayerId}:${nextView.phase}:${nextView.winnerPlayerId ?? ""}`;
      view = nextView;
      if (key !== snapshotKey) {
        snapshotKey = key;
        resetSelections();
      }
      render();
    },
    cancelSelections() {
      resetSelections();
      render();
    },
  };
}
