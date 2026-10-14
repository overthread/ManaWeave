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
 *
 * Targeting arrows are visual only: press T over a card in play (or click its
 * 🎯 hover badge), then click a unit — a server-synced arrow shows BOTH weavers
 * what it targets, and vanishes when the card leaves play.
 */
import { createCardEl } from "./card-ui.js";
import { createThreadEl } from "./loom-ui.js";
import { buildBattlefield } from "./battlefield-ui.js";
import { showContextMenu, closeContextMenu } from "./context-menu.js";
import { COLOURS, ORIENTATION_NAMES, formatCostHtml, formatCostText } from "./shared.js";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

export function createGameView(deps) {
  const { submitAction } = deps;

  let view = null;
  let cast = null; // { cardId, threads: Set<string> } while casting a hand card
  let weavePending = null; // { threadId } while choosing a weave direction
  let mulliganPicks = new Set(); // card ids picked to shuffle back during the opening mulligan
  let snapshotKey = "";
  let prevStats = null; // { life: {pid}, units: {cardId: {power, health}} } for delta floats
  let targeting = null; // { sourceCardId, sourceName } while marking a target unit (visual arrow)
  const pointer = { x: 0, y: 0 }; // last mouse position — T-key source lookup + live preview arrow

  const enemyIdOf = (v) => Object.keys(v.players).find((id) => id !== v.you);
  const myTurn = () => view && view.turnPlayerId === view.you && !view.winnerPlayerId;
  /** True while the viewer may still pick opening-hand cards to shuffle back. */
  const mulliganActive = () => !!view && view.phase === "mulligan" && !view.winnerPlayerId && !(view.mulliganed ?? {})[view.you];

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
    targeting = null;
    mulliganPicks.clear();
    // The WS push for this action may have rendered while `cast` was still set
    // (same turn+phase = unchanged snapshot key, so it kept the mid-cast UI:
    // no attack badges / clickable units). Repaint now that it's cleared.
    render();
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
    // On your own main step any payable card may be cast; outside your round
    // only Reaction spells appear in legalActions — both land on the shared stack.
    if (over()) return;
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

  // ------------------------------------------------------- targeting (visual)

  /** Arrows the given card in play is currently drawing (visual only). */
  const arrowsFrom = (cardId) => (view?.targetArrows ?? []).filter((a) => a.sourceCardId === cardId);

  function startTargeting(cardId, name) {
    if (!view || over()) return;
    targeting = { sourceCardId: cardId, sourceName: name };
    render();
  }

  function cancelTargeting() {
    if (!targeting) return;
    targeting = null;
    render();
  }

  async function submitTarget(unitId) {
    const source = targeting;
    if (!source) return;
    // One arrow per source — the server toggles it off when re-marking the same unit.
    await submit({ type: "manual_action", effect: { kind: "set_target" }, sourceCardId: source.sourceCardId, targetCardId: unitId });
  }

  function clearTargets(cardId) {
    return submitManual({ kind: "clear_target" }, { sourceCardId: cardId });
  }

  /** The card in play (battlefield unit or stack spell) under a viewport point, if any. */
  function cardInPlayAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const cardEl = hit?.closest?.(".card[data-card-id]");
    if (!cardEl || !cardEl.closest("#battlefield, #spell-stack")) return null;
    const id = cardEl.dataset.cardId;
    for (const p of Object.values(view?.players ?? {})) {
      const unit = (p.battlefield ?? []).find((c) => c.id === id);
      if (unit) return { id, name: unit.name };
    }
    for (const entry of view?.spellStack ?? []) {
      if (entry.card.id === id) return { id, name: entry.card.name };
    }
    return null;
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
    const items = [{ header: `${unit.name} — ${unit.power}⚔ / ${unit.health}❤` }];
    // Visual targeting: mark what this unit is aiming at (or clear its arrow).
    if (!over()) {
      items.push({ label: "🎯 target a unit…", hint: "visual arrow", onClick: () => startTargeting(unit.id, unit.name) });
      if (arrowsFrom(unit.id).length > 0) items.push({ label: "🚫 clear targeting", onClick: () => void clearTargets(unit.id) });
    }
    items.push(
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
    );
    showContextMenu(e.clientX, e.clientY, items);
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

  // ------------------------------------------------------------ spell stack

  /**
   * The shared spell stack: both weavers' cast spells wait here in cast order.
   * The view lists the top (newest cast, resolves first) at index 0 — rendered
   * leftmost with a "resolves next" badge. Resolution is by hand: right-click a
   * stack spell to resolve it, counter it, or send it elsewhere.
   */
  function stackMenu(entry, e) {
    const items = [
      { header: `${entry.card.name} — cast by ${entry.casterId === view.you ? "you" : entry.casterName}` },
    ];
    // Visual targeting: mark what this spell is aiming at before resolving it.
    if (!over()) {
      items.push({ label: "🎯 target a unit…", hint: "visual arrow", onClick: () => startTargeting(entry.card.id, entry.card.name) });
      if (arrowsFrom(entry.card.id).length > 0) items.push({ label: "🚫 clear targeting", onClick: () => void clearTargets(entry.card.id) });
    }
    items.push(
      {
        label: "✔ Resolve → discard",
        hint: "apply its effect by hand, then it leaves the stack",
        onClick: () => void submitManual({ kind: "resolve_spell" }, { targetCardId: entry.card.id }),
      },
      {
        label: "✖ Counter → discard",
        hint: "fizzles without resolving",
        danger: true,
        onClick: () => void submitManual({ kind: "resolve_spell", countered: true }, { targetCardId: entry.card.id }),
      },
      { label: "Send to…", sub: sendToItems(entry.card, "stack") },
    );
    showContextMenu(e.clientX, e.clientY, items);
  }

  const ordinal = (n) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
  };

  function renderSpellStack() {
    const box = $("spell-stack");
    box.replaceChildren();
    const stack = view.spellStack ?? [];

    const head = document.createElement("div");
    head.className = "spell-stack-head";
    const title = document.createElement("span");
    title.className = "spell-stack-title";
    title.textContent = `✦ spell stack — ${stack.length === 0 ? "empty" : `${stack.length} waiting`}`;
    head.appendChild(title);
    if (stack.length > 0) {
      const order = document.createElement("span");
      order.className = "spell-stack-order";
      order.textContent = "newest cast on the left · resolves first";
      head.appendChild(order);
      if (!over()) {
        const btn = document.createElement("button");
        btn.textContent = "✔ Resolve top";
        btn.title = "Resolve the top spell: apply its effect by hand, then it goes to its caster's discard";
        btn.addEventListener("click", () => void submitManual({ kind: "resolve_spell" }, { targetCardId: stack[0].card.id }));
        head.appendChild(btn);
      }
    }
    box.appendChild(head);

    const row = document.createElement("div");
    row.className = "spell-stack-row";
    stack.forEach((entry, i) => {
      const cell = document.createElement("div");
      cell.className = "spell-stack-entry";
      const badge = document.createElement("span");
      badge.className = `spell-stack-badge${i === 0 ? " next" : ""}`;
      badge.textContent = i === 0 ? "resolves next" : `resolves ${ordinal(i + 1)}`;
      cell.appendChild(badge);
      const caster = document.createElement("span");
      caster.className = "spell-stack-caster";
      caster.textContent = `${entry.casterId === view.you ? "you" : entry.casterName} cast${entry.card.reaction ? " · Reaction" : ""}`;
      cell.appendChild(caster);
      const el = createCardEl(entry.card, {});
      el.title += "\nT + click a unit: mark this spell's target (visual arrow) · right-click: resolve / counter / send";
      if (!over()) {
        const btn = document.createElement("button");
        btn.className = "target-btn";
        btn.textContent = "🎯";
        btn.title = "mark a target — click, then click a unit (draws a visual arrow; no game effect)";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          startTargeting(entry.card.id, entry.card.name);
        });
        el.appendChild(btn);
      }
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        stackMenu(entry, e);
      });
      cell.appendChild(el);
      row.appendChild(cell);
    });
    if (stack.length === 0) {
      const empty = document.createElement("span");
      empty.className = "muted spell-stack-empty";
      empty.textContent = "cast spells wait here — both weavers' spells (and Reactions) share this one stack";
      row.appendChild(empty);
    }
    box.appendChild(row);
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

      if (view.turnPlayerId === p.id && !view.winnerPlayerId && view.phase !== "mulligan") {
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
    // Payment picking follows the cast in progress — including an off-turn Reaction.
    const payingActive = !!cast;

    for (const t of myLoom) {
      const opts = {
        clickable: (payingActive && !t.exhausted) || weaveActive,
        paymentSelectable: payingActive && !t.exhausted,
        paying: cast?.threads.has(t.id) ?? false,
        highlightTarget: weaveActive && weavePending?.threadId === t.id,
      };
      const el = createThreadEl(t, opts);
      el.addEventListener("click", async () => {
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
        if (targeting) return unit.id !== targeting.sourceCardId; // any unit on either side may be marked
        if (unit.owner === view.you && myTurn() && view.phase === "main" && !cast) {
          if (unit.row === "back") return actions("move_unit").some((a) => a.cardId === unit.id);
        }
        return false;
      },
      isUnitTargetable: (unit) => !!targeting && unit.id !== targeting.sourceCardId,
      canAttackUnit: (unit) =>
        !targeting &&
        unit.owner === view.you &&
        unit.row === "front" &&
        myTurn() &&
        view.phase === "main" &&
        !cast &&
        actions("attack").some((a) => a.cardId === unit.id),
      canTargetUnit: () => !over(),
      onTargetClick: (unit) => startTargeting(unit.id, unit.name),
      onSlotClick: async (lane, row) => {
        if (!cast) return;
        await submitPlay({ laneIndex: lane, row });
      },
      onAttackClick: async (unit) => {
        await submit({ type: "attack", cardId: unit.id });
      },
      onUnitClick: async (unit) => {
        if (targeting) {
          // Clicking the marking card itself cancels; any other unit is marked.
          if (unit.id === targeting.sourceCardId) cancelTargeting();
          else await submitTarget(unit.id);
          return;
        }
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
    const picking = mulliganActive();
    const playable = new Set(actions("play_card").map((a) => a.cardId));
    for (const card of me?.hand ?? []) {
      // legalActions only offers payable casts: all cards on your main step,
      // Reaction spells outside your round. During the mulligan every card is
      // click-to-pick instead (picked cards get shuffled back into the deck).
      const isPlayable = playable.has(card.id) && !over();
      const el = createCardEl(card, {
        clickable: isPlayable || picking,
        playable: isPlayable,
        selected: cast?.cardId === card.id || mulliganPicks.has(card.id),
      });
      el.addEventListener("click", () => {
        if (targeting) {
          deps.toast("Finish marking the target first — click a unit, or press Esc to cancel.");
          return;
        }
        if (picking) {
          if (mulliganPicks.has(card.id)) mulliganPicks.delete(card.id);
          else mulliganPicks.add(card.id);
          render();
          return;
        }
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
    phasePill.textContent = view.phase === "mulligan" ? "opening hand — mulligan" : view.phase === "main" ? "main step" : "weave step";
    box.appendChild(phasePill);

    const round = document.createElement("span");
    round.className = "turn-note";
    if (view.winnerPlayerId) {
      round.textContent = "match finished";
    } else if (view.phase === "mulligan") {
      const enemyId = enemyIdOf(view);
      round.textContent = mulliganActive()
        ? "select cards in your hand to shuffle back — you'll draw that many"
        : `waiting for ${view.players[enemyId]?.name}'s mulligan…`;
    } else {
      round.textContent = myTurn() ? "your round — act in any order" : `${view.players[view.turnPlayerId]?.name}'s round…`;
    }
    box.appendChild(round);

    const hint = document.createElement("span");
    hint.className = "turn-note";
    hint.textContent = "right-click cards, threads & piles for manual actions · press T over a card in play to target";
    hint.title =
      "Manual actions are unrestricted: either weaver, any time. Targeting: hover a unit or a spell on the stack, press T (or click its 🎯 badge), then click a unit — a visual arrow shows both weavers what it targets. Right-click a stack spell to resolve it.";
    box.appendChild(hint);

    // Off-turn with a payable Reaction in hand: an open reaction window.
    if (!myTurn() && !view.winnerPlayerId && actions("play_card").length > 0) {
      const pill = document.createElement("span");
      pill.className = "phase-pill reaction-pill";
      pill.textContent = "✦ reaction window — you may cast Reactions";
      pill.title = "Reaction spells can be cast outside your own round; they go on top of the shared spell stack.";
      box.appendChild(pill);
    }

    if (myTurn() && view.phase !== "mulligan") {
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

    // Opening-hand mulligan: pick cards by clicking them, then confirm — or keep.
    if (view.phase === "mulligan" && !over()) {
      bar.classList.add("visible");
      if (mulliganActive()) {
        const n = mulliganPicks.size;
        const info = document.createElement("span");
        info.innerHTML = `<b>Mulligan</b> — click cards in your hand to shuffle them back into your deck; you'll draw that many. <b>${n}</b> picked.`;
        bar.appendChild(info);
        const shuffleBtn = document.createElement("button");
        shuffleBtn.className = "primary";
        shuffleBtn.textContent = n > 0 ? `🔀 Shuffle back ${n} & redraw` : "🔀 Shuffle back & redraw";
        shuffleBtn.disabled = n === 0;
        shuffleBtn.title = "The picked cards shuffle into your deck and you draw that many fresh ones";
        shuffleBtn.addEventListener("click", () => void submit({ type: "mulligan", cardIds: [...mulliganPicks] }));
        bar.appendChild(shuffleBtn);
        const keepBtn = document.createElement("button");
        keepBtn.textContent = "Keep hand";
        keepBtn.title = "Skip the mulligan and keep your opening hand as dealt";
        keepBtn.addEventListener("click", () => void submit({ type: "mulligan", cardIds: [] }));
        bar.appendChild(keepBtn);
      } else {
        const info = document.createElement("span");
        info.innerHTML = `<b>Mulligan taken</b> — waiting for ${view.players[enemyIdOf(view)]?.name ?? "the other weaver"} to decide…`;
        bar.appendChild(info);
      }
      return;
    }

    // Marking a target: a purely visual arrow from a card in play to a unit.
    if (targeting && !cast) {
      bar.classList.add("visible");
      const info = document.createElement("span");
      info.innerHTML = `<b>🎯 ${targeting.sourceName}</b> is marking a target — click a unit to draw the arrow (click the same unit again to unmark). Visual only; both weavers see it.`;
      info.title = "Targeting arrows carry no game effect — they just tell both weavers what a spell or unit is aiming at.";
      bar.appendChild(info);
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.title = "Stop marking a target (Esc works too)";
      cancel.addEventListener("click", cancelTargeting);
      bar.appendChild(cancel);
      return;
    }

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
    const isReaction = !myTurn();

    const need = card.cost?.length ?? 0;
    let hint = `Exhaust threads matching <b>${formatCostHtml(card.cost)}</b> — one per arrow, right colour and direction (a 🧵 Threadling may be sacrificed for any one arrow). `;
    hint += needsSlot
      ? "Then click a free slot on your side. "
      : isReaction
        ? "Then cast the Reaction — it goes on top of the shared spell stack and resolves first. "
        : "Then cast — it waits on the spell stack; resolve it by hand from there. ";

    const info = document.createElement("span");
    info.innerHTML = `<b>${card.name}</b>${isReaction ? " (Reaction)" : ""} — ${hint}(threads: ${cast.threads.size}/${need})`;
    bar.appendChild(info);

    if (!needsSlot) {
      const castBtn = document.createElement("button");
      castBtn.className = "primary";
      castBtn.textContent = isReaction ? "Cast Reaction" : "Cast";
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

  // -------------------------------------------------------- targeting arrows

  /** Centre of a card in play (battlefield unit or stack spell), viewport px. */
  function cardCentre(cardId) {
    const el = document.querySelector(
      `#battlefield .card[data-card-id="${CSS.escape(cardId)}"], #spell-stack .card[data-card-id="${CSS.escape(cardId)}"]`,
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** A gently bowed quadratic curve — keeps crossing arrows readable. */
  function arrowPathData(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(60, len * 0.18);
    const cx = (from.x + to.x) / 2 + (-dy / len) * bow;
    const cy = (from.y + to.y) / 2 + (dx / len) * bow;
    return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
  }

  /** Repaints every committed arrow (public — both weavers see the same set). */
  function renderTargetArrows() {
    const svg = $("target-arrows");
    if (!svg || !view) return;
    svg.setAttribute("width", String(window.innerWidth));
    svg.setAttribute("height", String(window.innerHeight));
    svg.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
    const g = svg.querySelector("#target-arrows-g");
    g.replaceChildren();
    for (const arrow of view.targetArrows ?? []) {
      const from = cardCentre(arrow.sourceCardId);
      const to = cardCentre(arrow.targetCardId);
      if (!from || !to) continue;
      const d = arrowPathData(from, to);
      const casing = document.createElementNS(SVG_NS, "path");
      casing.setAttribute("d", d);
      casing.setAttribute("class", "target-arrow-casing");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "target-arrow");
      path.setAttribute("marker-end", "url(#target-arrowhead)");
      g.append(casing, path);
    }
    updateTargetPreview();
  }

  /** Live rubber-band from the marking card to the cursor while targeting. */
  function updateTargetPreview() {
    const preview = $("target-arrows")?.querySelector("#target-preview");
    if (!preview) return;
    const from = targeting ? cardCentre(targeting.sourceCardId) : null;
    if (!from) {
      preview.setAttribute("d", "");
      return;
    }
    preview.setAttribute("d", arrowPathData(from, pointer));
  }

  // ------------------------------------------------------------ lifecycle

  function render() {
    if (!view) return;
    $("header-round").textContent = `round ${view.roundNumber} · turn ${view.turnNumber}`;
    $("header-turn").textContent = view.turnPlayerId === view.you ? "your turn" : "opponent's turn";
    document.body.classList.toggle("targeting-mode", !!targeting);
    renderBars();
    renderLooms();
    renderBattlefield();
    renderSpellStack();
    renderControls();
    renderCastingBar();
    renderPeekPanel();
    renderHand();
    renderLog();
    renderWinner();
    renderZoneViewer();
    renderTargetArrows();
  }

  function resetSelections() {
    cast = null;
    weavePending = null;
    targeting = null;
    mulliganPicks.clear();
  }

  // Right-panel "Add token" button (static HTML; the menu is built per click).
  $("add-token-btn")?.addEventListener("click", (e) => openTokenMenu(e.currentTarget));

  // Targeting mode: T over a card in play starts (or cancels) the marking; the
  // cursor position also drives the live preview arrow.
  document.addEventListener("mousemove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (targeting) updateTargetPreview();
  });
  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "t" && e.key !== "T") return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (!view || over()) return;
    if (targeting) {
      cancelTargeting();
      return;
    }
    if (cast) {
      deps.toast("Finish or cancel the cast first — target a spell once it waits on the stack.");
      return;
    }
    const hit = cardInPlayAt(pointer.x, pointer.y);
    if (!hit) {
      deps.toast("Hover a card in play — a unit or a spell on the stack — and press T to mark its target.");
      return;
    }
    startTargeting(hit.id, hit.name);
  });
  window.addEventListener("resize", renderTargetArrows);
  window.addEventListener("scroll", renderTargetArrows, true);

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
