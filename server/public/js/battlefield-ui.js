/** Battlefield grid: 3 lanes x 4 rows (enemy back, enemy front, my front, my back). */
import { createCardEl } from "./card-ui.js";

/**
 * Builds the battlefield element. Pure render: everything dynamic arrives via
 * `deps` (predicates + click handlers supplied by game-view). Attackable units
 * get a ⚔ badge in their top-left corner — attacking starts ONLY from that
 * badge, never from the card body. Right-clicking a unit opens its context
 * menu (manual damage / stat adjustments / send-to-area).
 */
export function buildBattlefield(deps) {
  const { view, enemyId, myId, isSlotActive, onSlotClick, onUnitClick, onUnitContext, canAttackUnit, onAttackClick } = deps;
  const grid = document.createElement("div");
  grid.className = "battlefield";
  grid.id = "battlefield";

  // lane labels
  for (let lane = 0; lane < 3; lane++) {
    const label = document.createElement("div");
    label.className = "lane-label";
    label.textContent = `lane ${lane + 1}`;
    grid.appendChild(label);
  }

  const layout = [
    { playerId: enemyId, row: "back", tag: "enemy back" },
    { playerId: enemyId, row: "front", tag: "enemy front" },
    { playerId: myId, row: "front", tag: "your front" },
    { playerId: myId, row: "back", tag: "your back" },
  ];

  for (const zone of layout) {
    for (let lane = 0; lane < 3; lane++) {
      const slot = document.createElement("div");
      slot.className = "slot";
      const unit = (view.players[zone.playerId]?.battlefield ?? []).find((c) => c.lane === lane && c.row === zone.row);
      if (unit) {
        const clickable = deps.isUnitClickable?.(unit) ?? false;
        const cardEl = createCardEl(unit, { clickable });
        if (canAttackUnit?.(unit)) {
          const btn = document.createElement("button");
          btn.className = "attack-btn";
          btn.textContent = "⚔";
          btn.title = "attack with this unit (exhausts it — resolve damage by hand)";
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onAttackClick(unit);
          });
          cardEl.appendChild(btn);
        }
        cardEl.addEventListener("click", () => onUnitClick(unit, zone.playerId));
        cardEl.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          onUnitContext?.(unit, zone.playerId, e);
        });
        slot.appendChild(cardEl);
      } else {
        const tag = document.createElement("span");
        tag.className = "slot-tag";
        tag.textContent = zone.tag;
        slot.appendChild(tag);
        const active = zone.playerId === myId && isSlotActive(lane, zone.row);
        if (active) {
          slot.classList.add("clickable");
          slot.addEventListener("click", () => onSlotClick(lane, zone.row));
        }
      }
      grid.appendChild(slot);
    }
  }
  return grid;
}
