/** Pure render helpers for cards (side-effect-free DOM builders). */
import { COLOURS, formatCostHtml, formatCostText } from "./shared.js";

export function createCardEl(card, opts = {}) {
  const el = document.createElement("div");
  el.className = `card colour-${card.colour}${opts.clickable ? " clickable" : ""}${opts.selected ? " selected" : ""}${opts.highlightTarget ? " highlight-target" : ""}${opts.playable ? " playable" : ""}${card.attackedThisTurn ? " exhausted" : ""}${card.row === "back" ? " backrow-unit" : ""}`;
  el.dataset.cardId = card.id;

  const stats =
    card.type === "unit"
      ? `<div class="card-stats"><span class="pw">${card.power} ⚔</span><span class="hp">${card.health} ❤</span></div>`
      : `<div class="card-stats"><span class="muted">✦ spell</span></div>`;
  const badges = [
    card.haste ? `<span class="badge haste">Quickstride</span>` : "",
    card.attackedThisTurn ? `<span class="badge exhausted">exhausted</span>` : "",
    card.movedThisTurn ? `<span class="badge">moved</span>` : "",
  ].join("");

  el.innerHTML = `
    <div class="card-sigil" aria-hidden="true">${COLOURS[card.colour]?.glyph ?? "◇"}</div>
    <div class="card-head"><span class="cost" title="exhaust one thread per arrow, matching its colour and direction">${formatCostHtml(card.cost)}</span><span class="card-name">${card.name}</span></div>
    <div class="card-text">${card.text ?? ""}</div>
    <div class="badges">${badges}</div>
    ${stats}`;
  el.title = `${COLOURS[card.colour]?.label ?? "Neutral"} · cost ${formatCostText(card.cost)}${card.type === "unit" ? ` · ${card.power}/${card.health}` : ""}`;
  return el;
}

export function createFacedownCard() {
  const el = document.createElement("div");
  el.className = "card facedown";
  el.innerHTML = `<span>✦</span>`;
  return el;
}
