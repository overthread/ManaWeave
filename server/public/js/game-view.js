/**
 * Battle screen orchestrator: renders from the last pushed view and owns the
 * interaction flows (casting with thread payment, attacking, moving, weaving).
 * Commands are matched against `view.legalActions` exactly — the server has the
 * final say on legality.
 *
 * Manual resolution has no panel: right-click any card, thread or pile to get a
 * context menu (rotate / excite threads, adjust unit power/health, deal damage,
 * discard, deck actions, send cards between areas, adjust life with −/+). Manual
 * actions are unrestricted by design — either weaver, any time. Stat changes
 * render as floating +N / −N indicators, computed by diffing consecutive pushed
 * views.
 */
import { createCardEl } from "./card-ui.js";
import { createThreadEl } from "./loom-ui.js";
import { buildBattlefield } from "./battlefield-ui.js";
import { showContextMenu, closeContextMenu } from "./context-menu.js";
import { COLOURS, ORIENTATION_NAMES, formatCostHtml, formatCostText } from "./shared.js";

const $ = (id) => document.getElementById(id);

export function createGameView(deps) {
  const { submitAction } = deps;

  let view = null;
  let cast = null; // { cardId, threads: Set<string> } while casting a hand card
  let weavePending = null; // { threadId } while choosing a weave direction
  let snapshotKey = "";
  let prevStats = null; // { life: {pid}, units: {cardId: {power, health}} } for delta floats

  const enemyIdOf = (v) => Object.keys(v.players).find((id) => id !== v.you);
  const myTurn = () => view && view.turnPlayerId === view.you && !view.winnerPlayerId;

  const actions = (type) => (view?.legalActions ?? []).filter((a) => a.type === type);
  const playActionsFor = (cardId) => actions("play_card").filter((a) => a.cardId === cardId);
  const sortedThreads = (ids) => [...ids].sort().join(",");
  const over = () => !!view?.winnerPlayerId;

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

  // ------------------------------------------------------------ submissions

  async function submit(partial) {
    await submitAction(partial);
    cast = null;
    weavePending = null;
  }

  async function submitManual(effect, extra = {}) {
    if (over()) {
      deps.toast("The weave is finished — no more manual actions.");
      return;
    }
    await submit({ type: "manual_action", effect, ...extra });
  }

  function moveCard(card, zone, position) {
    const effect = { kind: "move_card", zone };
    if (position) effect.position = position;
    return submitManual(effect, { targetCardId: card.id });
  }

  function startCasting(card) {
    if (!myTurn() || view.phase !== "main") return;
    const acts = playActionsFor(card.id);
    if (acts.length === 0) return;
    cast = { cardId: card.id, threads: new Set(autoThreads(card.id)) };
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

  // ---------------------------------------------------------- context menus

  /** Destinations for "Send to…", minus the zone the card is already in. */
  function sendToItems(card, fromZone) {
    const items = [];
    if (fromZone !== "hand") items.push({ label: "✋ to hand", onClick: () => void moveCard(card, "hand") });
    if (fromZone !== "deck") {
      items.push({ label: "▲ deck top", onClick: () => void moveCard(card, "deck", "top") });
      items.push({ label: "▼ deck bottom", onClick: () => void moveCard(card, "deck", "bottom") });
    }
    if (fromZone !== "graveyard") items.push({ label: "🗑 discard", onClick: () => void moveCard(card, "graveyard") });
    if (fromZone !== "exile") items.push({ label: "☠ purge", onClick: () => void moveCard(card, "exile") });
    return items;
  }

  function unitMenu(unit, e) {
    const target = { targetCardId: unit.id };
    showContextMenu(e.clientX, e.clientY, [
      { header: `${unit.name} — ${unit.power}⚔ / ${unit.health}❤` },
      {
        type: "stepper", label: "⚔ damage", value: 1, min: 1, max: 99, applyLabel: "Deal",
        onApply: (n) => void submitManual({ kind: "damage_unit", amount: n }, target),
      },
      {
        type: "stepper", label: "power", value: 1, min: -99, max: 99, applyLabel: "Apply",
        onApply: (n) => void submitManual({ kind: "buff_unit", atk: n, hp: 0 }, target),
      },
      {
        type: "stepper", label: "health", value: 1, min: -99, max: 99, applyLabel: "Apply",
        onApply: (n) => void submitManual({ kind: "buff_unit", atk: 0, hp: n }, target),
      },
      { label: "⤴ return to owner's hand", onClick: () => void submitManual({ kind: "return_to_hand" }, target) },
      { label: "☠ destroy", danger: true, hint: "to discard", onClick: () => void submitManual({ kind: "destroy_unit" }, target) },
      { label: "Send to…", sub: sendToItems(unit, "battlefield") },
    ]);
  }

  function handMenu(card, e) {
    showContextMenu(e.clientX, e.clientY, [
      { header: card.name },
      { label: "🗑 Discard", onClick: () => void moveCard(card, "graveyard") },
      { label: "Send to…", sub: sendToItems(card, "hand") },
    ]);
  }

  function threadMenu(t, e) {
    const items = [
      {
        header: t.token
          ? `Threadling — colourless token thread${t.excite > 0 ? ` · ✦${t.excite}` : ""}`
          : `${COLOURS[t.colour]?.label ?? "?"} thread — pointing ${ORIENTATION_NAMES[t.orientation] ?? "up"}${t.excite > 0 ? ` · ✦${t.excite}` : ""}`,
      },
      { label: "↻ rotate clockwise", onClick: () => void submitManual({ kind: "rotate_thread" }, { targetThreadId: t.id, targetDirection: "cw" }) },
      { label: "↺ rotate counter-clockwise", onClick: () => void submitManual({ kind: "rotate_thread" }, { targetThreadId: t.id, targetDirection: "ccw" }) },
    ];
    if (t.exhausted) {
      items.push({ label: "▲ ready (un-flip)", onClick: () => void submitManual({ kind: "ready_thread" }, { targetThreadId: t.id }) });
    } else {
      items.push({ label: "▼ exhaust (flip)", onClick: () => void submitManual({ kind: "exhaust_thread" }, { targetThreadId: t.id }) });
    }
    // Excite: a token sits on the thread until unleashed (Unleash spends it).
    items.push({ label: "✦ excite (add token)", onClick: () => void submitManual({ kind: "excite_thread" }, { targetThreadId: t.id }) });
    if (t.excite > 0) {
      items.push({ label: "✧ unleash (spend token)", hint: `✦${t.excite} on this thread`, onClick: () => void submitManual({ kind: "unleash_thread" }, { targetThreadId: t.id }) });
    }
    // Animate: the thread becomes a unit (1/1 token / 2/2 real thread) on its owner's side.
    const animItems = animateItems(t);
    items.push(
      animItems.length > 0
        ? { label: "⚔ Animate…", hint: `becomes a ${t.token ? "1/1" : "2/2"}`, sub: animItems }
        : { label: "⚔ Animate…", hint: "no free slots", disabled: true },
    );
    // A Threadling can be sacrificed outright — it leaves the loom (real threads cannot).
    if (t.token) {
      items.push({ label: "🧵 sacrifice Threadling", hint: "leaves the loom", danger: true, onClick: () => void submitManual({ kind: "sacrifice_threadling" }, { targetThreadId: t.id }) });
    }
    // The round's real weave, offered alongside when this thread is legally weaveable.
    for (const direction of ["cw", "ccw"]) {
      if (actions("weave_thread").some((a) => a.threadId === t.id && a.direction === direction)) {
        items.push({
          label: direction === "cw" ? "Weave ↻ this round" : "Weave ↺ this round",
          hint: "uses your weave step",
          onClick: () => void submit({ type: "weave_thread", threadId: t.id, direction }),
        });
      }
    }
    showContextMenu(e.clientX, e.clientY, items);
  }

  /** Free slots on the thread owner's side of the board (Animate destinations). */
  function animateItems(t) {
    const ownerId = Object.keys(view?.looms ?? {}).find((pid) => (view.looms[pid] ?? []).some((x) => x.id === t.id));
    if (!ownerId) return [];
    const units = view.players[ownerId]?.battlefield ?? [];
    const items = [];
    for (let lane = 0; lane < 3; lane++) {
      for (const row of ["front", "back"]) {
        if (units.some((u) => u.lane === lane && u.row === row)) continue;
        items.push({
          label: `lane ${lane + 1} · ${row}`,
          onClick: () => void submitManual({ kind: "animate_thread" }, { targetThreadId: t.id, targetLane: lane, targetRow: row }),
        });
      }
    }
    return items;
  }

  /** Right-panel token picker: sprout a token into either weaver's loom (Sprout). */
  function openTokenMenu(btn) {
    if (!view) return;
    if (over()) {
      deps.toast("The weave is finished — no more manual actions.");
      return;
    }
    const rect = btn.getBoundingClientRect();
    const targets = Object.keys(view.players).map((pid) => ({
      label: pid === view.you ? "→ your loom" : `→ ${view.players[pid]?.name}'s loom`,
      onClick: () => void submitManual({ kind: "add_token", token: "threadling" }, { targetPlayerId: pid }),
    }));
    showContextMenu(rect.left, rect.bottom + 4, [
      { header: "Add token" },
      { label: "🧵 Threadling", hint: "colourless token · sacrificed to pay any one arrow", sub: targets },
    ]);
  }

  function deckMenu(playerId, e) {
    const p = view.players[playerId];
    const mine = playerId === view.you;
    const who = mine ? "Your" : `${p.name}'s`;
    const target = { targetPlayerId: playerId };
    const items = [
      { header: `${who} deck — ${p.deckCount} cards` },
      {
        type: "stepper", label: mine ? "Draw" : "They draw", value: 1, min: 1, max: 20, applyLabel: "Draw",
        onApply: (n) => void submitManual({ kind: "draw", amount: n }, target),
      },
    ];
    if (mine) {
      items.push({
        type: "stepper", label: "Look at top", value: 3, min: 1, max: 20, applyLabel: "Peek",
        onApply: (n) => void submitManual({ kind: "peek_deck", amount: n }, target),
      });
    }
    items.push(
      { label: "🔀 shuffle", onClick: () => void submitManual({ kind: "shuffle_deck" }, target) },
      {
        type: "stepper", label: "Purge top", value: 1, min: 1, max: 20, applyLabel: "Purge",
        onApply: (n) => void submitManual({ kind: "purge_deck_top", amount: n }, target),
      },
    );
    showContextMenu(e.clientX, e.clientY, items);
  }

  // ------------------------------------------------------------ zone viewer

  let zoneViewer = null; // { playerId, zoneKey } while the pile overlay is open

  function renderZoneViewer() {
    if (!zoneViewer) {
      $("zone-viewer").classList.remove("visible");
      return;
    }
    const p = view.players[zoneViewer.playerId];
    if (!p) {
      zoneViewer = null;
      $("zone-viewer").classList.remove("visible");
      return;
    }
    const zoneKey = zoneViewer.zoneKey;
    const cards = zoneKey === "graveyard" ? p.graveyard : p.exile;
    const whose = zoneViewer.playerId === view.you ? "Your" : `${p.name}'s`;
    $("zone-viewer-title").textContent = `${whose} ${zoneKey === "graveyard" ? "discard" : "purge"} — ${cards.length} card${cards.length === 1 ? "" : "s"}`;
    const grid = $("zone-viewer-grid");
    grid.replaceChildren();
    if (cards.length === 0) {
      const empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "empty";
      grid.appendChild(empty);
    }
    for (const card of cards) {
      const el = createCardEl(card, {});
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [{ header: card.name }, { label: "Send to…", sub: sendToItems(card, zoneKey) }]);
      });
      grid.appendChild(el);
    }
    $("zone-viewer").classList.add("visible");
  }

  function openZoneViewer(playerId, zoneKey) {
    if (!view.players[playerId]) return;
    zoneViewer = { playerId, zoneKey };
    renderZoneViewer();
  }

  // ------------------------------------------------------------ renders

  function createPile(kind, playerId) {
    const p = view.players[playerId];
    const count = kind === "deck" ? p.deckCount : kind === "graveyard" ? p.graveyardCount : p.exileCount;
    const mine = playerId === view.you;
    const el = document.createElement("div");
    el.className = `pile ${kind}${count === 0 ? " empty" : ""}`;
    const icon = kind === "deck" ? "🂠" : kind === "graveyard" ? "⚰" : "☠";
    const name = kind === "deck" ? "deck" : kind === "graveyard" ? "discard" : "purge";
    el.innerHTML = `<span class="pile-icon">${icon}</span><span class="pile-name">${name}</span><span class="pile-count">${count}</span>`;
    el.title = mine
      ? `${name}: ${count} cards — left-click for actions, right-click for the menu`
      : `${p.name}'s ${name}: ${count} cards`;
    const open = (e) => {
      if (kind === "deck") deckMenu(playerId, e);
      else openZoneViewer(playerId, kind);
    };
    el.addEventListener("click", (e) => open(e));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      open(e);
    });
    return el;
  }

  function renderBars() {
    const enemyId = enemyIdOf(view);

    const bar = (p) => {
      const el = document.createElement("div");
      el.className = "player-bar";
      const name = document.createElement("span");
      name.className = "pname";
      name.textContent = `${p.name}${p.id === view.you ? " (you)" : ""}`;
      el.appendChild(name);

      const lifeBox = document.createElement("span");
      lifeBox.className = "life-box";
      const minus = document.createElement("button");
      minus.className = "life-btn";
      minus.textContent = "−";
      minus.title = "lose 1 life";
      minus.disabled = over();
      minus.addEventListener("click", () => void submitManual({ kind: "damage_face", amount: 1 }, { targetPlayerId: p.id }));
      const life = document.createElement("span");
      life.className = "life";
      life.title = "life";
      life.textContent = `${p.life} ❤`;
      const plus = document.createElement("button");
      plus.className = "life-btn";
      plus.textContent = "+";
      plus.title = "gain 1 life";
      plus.disabled = over();
      plus.addEventListener("click", () => void submitManual({ kind: "heal_face", amount: 1 }, { targetPlayerId: p.id }));
      lifeBox.append(minus, life, plus);
      el.appendChild(lifeBox);

      if (view.turnPlayerId === p.id && !view.winnerPlayerId) {
        const flag = document.createElement("span");
        flag.className = "turn-flag";
        flag.textContent = "✦ weaving now";
        el.appendChild(flag);
      }

      const spacer = document.createElement("span");
      spacer.style.flex = "1";
      el.appendChild(spacer);

      const hand = document.createElement("span");
      hand.className = "zone";
      hand.textContent = `hand ${p.handCount}`;
      el.appendChild(hand);
      el.appendChild(createPile("deck", p.id));
      el.appendChild(createPile("graveyard", p.id));
      el.appendChild(createPile("exile", p.id));
      return el;
    };

    $("enemy-bar").replaceChildren(bar(view.players[enemyId]));
    $("my-bar").replaceChildren(bar(view.players[view.you]));
  }

  function renderLooms() {
    const enemyId = enemyIdOf(view);
    const myLoom = view.looms[view.you] ?? [];
    const enemyLoom = view.looms[enemyId] ?? [];

    const enemyBox = $("enemy-loom");
    enemyBox.replaceChildren();
    const enemyLabel = document.createElement("span");
    enemyLabel.className = "loom-label";
    enemyLabel.textContent = "their loom";
    enemyBox.appendChild(enemyLabel);
    for (const t of enemyLoom) {
      const el = createThreadEl(t, {});
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        threadMenu(t, e);
      });
      enemyBox.appendChild(el);
    }

    const myBox = $("my-loom");
    myBox.replaceChildren();
    const myLabel = document.createElement("span");
    myLabel.className = "loom-label";
    myLabel.textContent = "your loom";
    myBox.appendChild(myLabel);

    const weaveActive = myTurn() && view.phase === "weave" && actions("weave_thread").length > 0;
    const payingActive = myTurn() && view.phase === "main" && !!cast;

    for (const t of myLoom) {
      const opts = {
        clickable: (payingActive && !t.exhausted) || weaveActive,
        paymentSelectable: payingActive && !t.exhausted,
        paying: cast?.threads.has(t.id) ?? false,
        highlightTarget: weaveActive && weavePending?.threadId === t.id,
      };
      const el = createThreadEl(t, opts);
      el.addEventListener("click", async () => {
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
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        threadMenu(t, e);
      });
      myBox.appendChild(el);
    }
  }

  function renderBattlefield() {
    const enemyId = enemyIdOf(view);
    const card = castingCard();
    const isUnitCast = !!card && card.type === "unit";

    const grid = buildBattlefield({
      view,
      enemyId,
      myId: view.you,
      isSlotActive: (lane, row) => isUnitCast && playActionsFor(cast.cardId).some((a) => a.laneIndex === lane && a.row === row),
      isUnitClickable: (unit) => {
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
        actions("attack").some((a) => a.cardId === unit.id),
      onSlotClick: async (lane, row) => {
        if (!cast) return;
        await submitPlay({ laneIndex: lane, row });
      },
      onAttackClick: async (unit) => {
        await submit({ type: "attack", cardId: unit.id });
      },
      onUnitClick: async (unit) => {
        if (!myTurn() || view.phase !== "main" || cast) return;
        if (unit.owner !== view.you) return;
        if (unit.row === "back" && actions("move_unit").some((a) => a.cardId === unit.id)) {
          await submit({ type: "move_unit", cardId: unit.id });
        }
      },
      onUnitContext: (unit, _ownerId, e) => unitMenu(unit, e),
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
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        handMenu(card, e);
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

    const hint = document.createElement("span");
    hint.className = "turn-note";
    hint.textContent = "right-click cards, threads & piles for manual actions";
    hint.title = "Manual actions are unrestricted: either weaver, any time.";
    box.appendChild(hint);

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
    let hint = `Exhaust threads matching <b>${formatCostHtml(card.cost)}</b> — one per arrow, right colour and direction (a 🧵 Threadling may be sacrificed for any one arrow). `;
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

  /** Private look at the top of your own deck (server-tracked, owner-only). */
  function renderPeekPanel() {
    const panel = $("peek-panel");
    panel.replaceChildren();
    const peek = view.players[view.you]?.deckPeek ?? [];
    if (peek.length === 0) {
      panel.classList.remove("visible");
      return;
    }
    panel.classList.add("visible");
    const info = document.createElement("span");
    info.className = "peek-info";
    info.innerHTML = `<b>Peek:</b> your top ${peek.length} card${peek.length === 1 ? "" : "s"} (top first) — right-click to send one elsewhere.`;
    panel.appendChild(info);
    const row = document.createElement("div");
    row.className = "peek-row";
    for (const card of peek) {
      const el = createCardEl(card, {});
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [{ header: card.name }, { label: "Send to…", sub: sendToItems(card, "deck") }]);
      });
      row.appendChild(el);
    }
    panel.appendChild(row);
    const close = document.createElement("button");
    close.textContent = "Done looking";
    close.addEventListener("click", () => void submitManual({ kind: "peek_deck", amount: 0 }, { targetPlayerId: view.you }));
    panel.appendChild(close);
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

  // -------------------------------------------------------- delta indicators

  function snapshotStats(v) {
    const units = {};
    for (const p of Object.values(v.players)) {
      for (const u of p.battlefield) units[u.id] = { power: u.power, health: u.health };
    }
    const life = {};
    for (const p of Object.values(v.players)) life[p.id] = p.life;
    return { life, units };
  }

  function diffDeltas(prev, next) {
    const out = [];
    for (const [pid, life] of Object.entries(next.life)) {
      if (prev.life[pid] !== undefined && prev.life[pid] !== life) out.push({ kind: "life", pid, delta: life - prev.life[pid] });
    }
    for (const [cardId, s] of Object.entries(next.units)) {
      const p = prev.units[cardId];
      if (!p) continue;
      if (p.power !== s.power) out.push({ kind: "power", cardId, delta: s.power - p.power });
      if (p.health !== s.health) out.push({ kind: "health", cardId, delta: s.health - p.health });
    }
    return out;
  }

  function spawnDeltas(deltas) {
    for (const d of deltas) {
      let anchor = null;
      if (d.kind === "life") {
        anchor = document.querySelector(d.pid === view.you ? "#my-bar .life" : "#enemy-bar .life");
      } else {
        anchor = document.querySelector(`#battlefield .card[data-card-id="${CSS.escape(d.cardId)}"] .${d.kind === "power" ? "pw" : "hp"}`);
      }
      if (!anchor) continue;
      const f = document.createElement("span");
      f.className = `delta-float ${d.delta > 0 ? "up" : "down"}`;
      f.textContent = `${d.delta > 0 ? "+" : ""}${d.delta}`;
      anchor.appendChild(f);
      setTimeout(() => f.remove(), 2300);
    }
  }

  // ------------------------------------------------------------ lifecycle

  function render() {
    if (!view) return;
    $("header-round").textContent = `round ${view.roundNumber} · turn ${view.turnNumber}`;
    $("header-turn").textContent = view.turnPlayerId === view.you ? "your turn" : "opponent's turn";
    renderBars();
    renderLooms();
    renderBattlefield();
    renderControls();
    renderCastingBar();
    renderPeekPanel();
    renderHand();
    renderLog();
    renderWinner();
    renderZoneViewer();
  }

  function resetSelections() {
    cast = null;
    weavePending = null;
  }

  // Right-panel "Add token" button (static HTML; the menu is built per click).
  $("add-token-btn")?.addEventListener("click", (e) => openTokenMenu(e.currentTarget));

  return {
    render(nextView) {
      const key = `${nextView.gameId}:${nextView.turnNumber}:${nextView.turnPlayerId}:${nextView.phase}:${nextView.winnerPlayerId ?? ""}`;
      const nextStats = snapshotStats(nextView);
      const deltas = prevStats ? diffDeltas(prevStats, nextStats) : [];
      prevStats = nextStats;
      view = nextView;
      if (key !== snapshotKey) {
        snapshotKey = key;
        resetSelections();
      }
      closeContextMenu(); // a fresh view invalidates any open menu's targets
      render();
      spawnDeltas(deltas);
    },
    cancelSelections() {
      resetSelections();
      closeContextMenu();
      render();
    },
    closeZoneViewer() {
      zoneViewer = null;
      $("zone-viewer").classList.remove("visible");
    },
  };
}
