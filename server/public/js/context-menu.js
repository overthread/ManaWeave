/**
 * Right-click context menus for the battle screen.
 *
 * One menu at a time, fixed-positioned and viewport-clamped. Items:
 *   { header: "Unit — Cinder Whelp" }                       section title
 *   { label, hint?, danger?, disabled?, onClick }           plain action
 *   { label, sub: Item[] }                                  submenu (on hover)
 *   { type: "stepper", label, value, min, max, applyLabel, onApply }
 *        [-] value [+] Apply row for amounts (damage, power/health deltas…)
 *
 * Clicking an action closes the whole menu; Escape / outside click / opening
 * another menu closes it too.
 */

let activeMenu = null;

export function closeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
    document.removeEventListener("pointerdown", onGlobalDown, true);
    window.removeEventListener("keydown", onGlobalKey, true);
    window.removeEventListener("resize", closeContextMenu);
  }
}

function onGlobalDown(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeContextMenu();
}

function onGlobalKey(e) {
  if (e.key === "Escape") closeContextMenu();
}

function clampToViewport(el, x, y) {
  document.body.appendChild(el);
  const rect = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function buildItem(item, close) {
  if (item.header) {
    const h = document.createElement("div");
    h.className = "ctx-header";
    h.textContent = item.header;
    return h;
  }
  if (item.type === "stepper") {
    const row = document.createElement("div");
    row.className = "ctx-stepper";
    let value = Math.max(item.min ?? 1, Math.min(item.max ?? 99, item.value ?? 1));
    const label = document.createElement("span");
    label.className = "ctx-stepper-label";
    label.textContent = item.label;
    const dec = document.createElement("button");
    dec.className = "ctx-step";
    dec.textContent = "−";
    const val = document.createElement("span");
    val.className = "ctx-value";
    val.textContent = String(value);
    const inc = document.createElement("button");
    inc.className = "ctx-step";
    inc.textContent = "+";
    const apply = document.createElement("button");
    apply.className = "ctx-apply";
    apply.textContent = item.applyLabel ?? "Apply";
    const sync = () => {
      val.textContent = String(value);
      val.classList.toggle("neg", value < 0);
    };
    dec.addEventListener("click", () => {
      value = Math.max(item.min ?? 1, value - (item.step ?? 1));
      sync();
    });
    inc.addEventListener("click", () => {
      value = Math.min(item.max ?? 99, value + (item.step ?? 1));
      sync();
    });
    apply.addEventListener("click", () => {
      close();
      item.onApply?.(value);
    });
    row.append(label, dec, val, inc, apply);
    return row;
  }
  const el = document.createElement("div");
  el.className = `ctx-item${item.danger ? " danger" : ""}${item.disabled ? " disabled" : ""}${item.sub ? " has-sub" : ""}`;
  const text = document.createElement("span");
  text.textContent = item.label;
  el.appendChild(text);
  if (item.hint) {
    const hint = document.createElement("span");
    hint.className = "ctx-hint";
    hint.textContent = item.hint;
    el.appendChild(hint);
  }
  if (item.sub) {
    const arrow = document.createElement("span");
    arrow.className = "ctx-sub-arrow";
    arrow.textContent = "▸";
    el.appendChild(arrow);
    const sub = buildMenu(item.sub, close);
    sub.classList.add("ctx-submenu");
    el.appendChild(sub);
    el.addEventListener("mouseenter", () => {
      for (const other of el.parentElement.querySelectorAll(":scope > .ctx-item > .ctx-submenu.open")) other.classList.remove("open");
      sub.classList.add("open");
      const rect = sub.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        sub.style.left = "";
        sub.style.right = "100%";
      }
    });
  } else if (!item.disabled) {
    el.addEventListener("click", () => {
      close();
      item.onClick?.();
    });
  }
  return el;
}

function buildMenu(items, close) {
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  for (const item of items) menu.appendChild(buildItem(item, close));
  menu.addEventListener("contextmenu", (e) => e.preventDefault());
  menu.addEventListener("pointerdown", (e) => e.stopPropagation());
  return menu;
}

/** Opens the context menu at screen coordinates; closes any open one first. */
export function showContextMenu(x, y, items) {
  closeContextMenu();
  const menu = buildMenu(items, closeContextMenu);
  activeMenu = menu;
  document.addEventListener("pointerdown", onGlobalDown, true);
  window.addEventListener("keydown", onGlobalKey, true);
  window.addEventListener("resize", closeContextMenu);
  clampToViewport(menu, x, y);
  return menu;
}
