/** Deck builder composition root: loom picker, catalog, deck list, persistence. */
import { api, COLOURS, requireAuth, renderAuthHeader, formatCostHtml, formatCostText, showError } from "./shared.js";

const DECK_MIN = 20;
const DECK_MAX = 30;
const MAX_COPIES = 3;
const LOOM_SIZE = 4;
const THREAD_COLOURS = ["crimson", "azure", "verdant"];

const SAMPLES = {
  growth: {
    name: "Verdant Growth",
    loom: ["verdant", "verdant", "azure", "crimson"],
    cards: { sapling_warden: 3, wildwood_elk: 3, grovekeeper: 3, thornhide_behemoth: 2, ancient_treant: 2, wildbloom: 3, natures_bounty: 2, deep_roots: 1, wandering_apprentice: 1 },
  },
  bulwark: {
    name: "Verdant Bulwark",
    loom: ["verdant", "verdant", "verdant", "verdant"],
    cards: { sapling_warden: 3, wildwood_elk: 2, grovekeeper: 2, thornhide_behemoth: 3, ancient_treant: 2, wildbloom: 3, titangrowth: 2, roadwarden: 2, wanderers_map: 1 },
  },
};

const state = {
  catalog: [],
  loom: ["verdant", "verdant", "azure", "crimson"],
  deck: new Map(), // cardDefId -> quantity
  deckId: null,
  filterColour: "all",
  filterType: "all",
  decks: [],
};

const $ = (id) => document.getElementById(id);

function deckCount() {
  let n = 0;
  for (const q of state.deck.values()) n += q;
  return n;
}

/** Per colour, the most threads any single decked card needs simultaneously. */
function loomNeeds() {
  const needs = {};
  for (const def of state.catalog) {
    if (!state.deck.get(def.id)) continue;
    const counts = {};
    for (const e of def.cost ?? []) {
      if (e.colour && e.colour !== "any" && e.colour !== "neutral") counts[e.colour] = (counts[e.colour] ?? 0) + 1;
    }
    for (const [c, n] of Object.entries(counts)) needs[c] = Math.max(needs[c] ?? 0, n);
  }
  return needs;
}

function validate() {
  const notes = [];
  const total = deckCount();
  if (total < DECK_MIN) notes.push(`Needs ${DECK_MIN - total} more card(s) (min ${DECK_MIN}).`);
  if (total > DECK_MAX) notes.push(`Too many cards (${total} > ${DECK_MAX}).`);
  const loomCounts = {};
  for (const c of state.loom) loomCounts[c] = (loomCounts[c] ?? 0) + 1;
  for (const [c, n] of Object.entries(loomNeeds())) {
    if ((loomCounts[c] ?? 0) < n) {
      notes.push(`Cards in this deck need ${n} ${COLOURS[c].label} thread(s) at once — the loom only has ${loomCounts[c] ?? 0}.`);
    }
  }
  return notes;
}

function cardDefById(id) {
  return state.catalog.find((d) => d.id === id);
}

// ------------------------------------------------------------- rendering

function renderLoom() {
  const picker = $("loom-picker");
  picker.innerHTML = "";
  state.loom.forEach((colour, i) => {
    const el = document.createElement("div");
    el.className = `thread colour-${colour}`;
    el.title = `${COLOURS[colour].label} thread — click to change colour`;
    el.innerHTML = `<div class="diamond"></div><div class="arrow">↑</div><div class="orient-tag">${COLOURS[colour].label}</div>`;
    el.addEventListener("click", () => {
      const next = THREAD_COLOURS[(THREAD_COLOURS.indexOf(colour) + 1) % THREAD_COLOURS.length];
      state.loom[i] = next;
      renderLoom();
      renderValidation();
    });
    picker.appendChild(el);
  });
}

function renderValidation() {
  const notes = validate();
  const loomNote = $("loom-note");
  loomNote.textContent = state.loom.map((c) => COLOURS[c].label).join(" · ");
  loomNote.className = "validation-note";
  const deckNote = $("deck-note");
  if (notes.length === 0) {
    deckNote.textContent = `✔ ${deckCount()} cards — legal pattern.`;
    deckNote.className = "validation-note ok";
  } else {
    deckNote.textContent = notes.join(" ");
    deckNote.className = "validation-note bad";
  }
  $("save-deck").disabled = notes.length > 0;
  $("save-deck").textContent = state.deckId ? "Update Deck" : "Save Deck";
}

function renderCatalog() {
  const grid = $("catalog-grid");
  grid.innerHTML = "";
  for (const def of state.catalog) {
    if (state.filterColour !== "all" && def.colour !== state.filterColour) continue;
    if (state.filterType !== "all" && def.type !== state.filterType) continue;
    const qty = state.deck.get(def.id) ?? 0;

    const card = document.createElement("div");
    card.className = `card colour-${def.colour}`;
    const stats =
      def.type === "unit"
        ? `<div class="card-stats"><span class="pw">${def.attack} ⚔</span><span class="hp">${def.health} ❤</span></div>`
        : `<div class="card-stats"><span class="muted">✦ spell</span></div>`;
    const badges = [def.haste ? `<span class="badge haste">Quickstride</span>` : ""].join("");
    card.innerHTML = `
      <div class="card-sigil" aria-hidden="true">${COLOURS[def.colour]?.glyph ?? "◇"}</div>
      <div class="card-head"><span class="cost" title="${formatCostText(def.cost)} — one thread per arrow, matching colour and direction">${formatCostHtml(def.cost, { onDark: true })}</span><span class="card-name">${def.title}</span></div>
      <div class="card-text">${def.text ?? ""}</div>
      <div class="badges">${badges}</div>
      ${stats}`;

    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "6px";
    controls.style.justifyContent = "space-between";
    const minus = document.createElement("button");
    minus.textContent = "–";
    minus.disabled = qty === 0;
    const count = document.createElement("span");
    count.style.alignSelf = "center";
    count.textContent = `${qty}/${MAX_COPIES}`;
    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.disabled = qty >= MAX_COPIES;
    minus.addEventListener("click", () => {
      const q = (state.deck.get(def.id) ?? 0) - 1;
      if (q <= 0) state.deck.delete(def.id);
      else state.deck.set(def.id, q);
      renderAll();
    });
    plus.addEventListener("click", () => {
      state.deck.set(def.id, Math.min(MAX_COPIES, (state.deck.get(def.id) ?? 0) + 1));
      renderAll();
    });
    controls.append(minus, count, plus);
    card.appendChild(controls);
    grid.appendChild(card);
  }
}

function renderDeckEntries() {
  const box = $("deck-entries");
  box.innerHTML = "";
  const entries = [...state.deck.entries()];
  if (entries.length === 0) {
    box.innerHTML = `<span class="muted" style="font-size:13px">Empty — add cards from the catalog.</span>`;
    return;
  }
  entries.sort((a, b) => {
    const da = cardDefById(a[0]);
    const db = cardDefById(b[0]);
    return (da?.title ?? "").localeCompare(db?.title ?? "");
  });
  for (const [id, qty] of entries) {
    const def = cardDefById(id);
    const row = document.createElement("div");
    row.className = "deck-entry";
    const colourTag = `<span style="color:${COLOURS[def?.colour ?? "neutral"].hex}">●</span>`;
    row.innerHTML = `<span class="qty">${qty}×</span><span style="flex:1">${colourTag} ${def?.title ?? id}</span>`;
    const rm = document.createElement("button");
    rm.textContent = "remove";
    rm.addEventListener("click", () => {
      state.deck.delete(id);
      renderAll();
    });
    row.appendChild(rm);
    box.appendChild(row);
  }
}

function renderFilters() {
  const colours = $("colour-filters");
  colours.innerHTML = "";
  for (const [key, c] of Object.entries({ all: { label: "All colours", hex: "#e8e4f2" }, ...COLOURS })) {
    const chip = document.createElement("span");
    chip.className = `chip ${state.filterColour === key ? "active" : ""}`;
    chip.textContent = `${c.glyph ?? ""} ${c.label}`;
    chip.style.cursor = "pointer";
    chip.addEventListener("click", () => {
      state.filterColour = key;
      renderFilters();
      renderCatalog();
    });
    colours.appendChild(chip);
  }
  const types = $("type-filters");
  types.innerHTML = "";
  for (const [key, label] of [["all", "All types"], ["unit", "Units"], ["spell", "Spells"]]) {
    const chip = document.createElement("span");
    chip.className = `chip ${state.filterType === key ? "active" : ""}`;
    chip.textContent = label;
    chip.style.cursor = "pointer";
    chip.addEventListener("click", () => {
      state.filterType = key;
      renderFilters();
      renderCatalog();
    });
    types.appendChild(chip);
  }
}

function renderAll() {
  renderCatalog();
  renderDeckEntries();
  renderValidation();
}

// ------------------------------------------------------------ persistence

async function refreshSavedDecks() {
  const { decks } = await api("/api/decks");
  state.decks = decks;
  const box = $("saved-decks");
  box.innerHTML = "";
  if (decks.length === 0) {
    box.innerHTML = `<span class="muted" style="font-size:13px">No saved patterns yet.</span>`;
    return;
  }
  for (const deck of decks) {
    const row = document.createElement("div");
    row.className = "deck-entry";
    row.innerHTML = `<span style="flex:1">${deck.name} <span class="muted">(${deck.loom.join("/")})</span></span>`;
    const load = document.createElement("button");
    load.textContent = "load";
    load.addEventListener("click", () => {
      state.deckId = deck.id;
      state.loom = [...deck.loom];
      state.deck = new Map(deck.cards.map((c) => [c.cardDefId, c.quantity]));
      $("deck-name").value = deck.name;
      renderAll();
    });
    const del = document.createElement("button");
    del.textContent = "delete";
    del.addEventListener("click", async () => {
      try {
        await api(`/api/decks/${deck.id}`, { method: "DELETE" });
        if (state.deckId === deck.id) state.deckId = null;
        await refreshSavedDecks();
      } catch (err) {
        showError(err.message);
      }
    });
    row.append(load, del);
    box.appendChild(row);
  }
}

async function saveDeck() {
  if (validate().length > 0) return;
  const body = {
    name: $("deck-name").value.trim() || "Untitled pattern",
    loom: state.loom,
    cards: [...state.deck.entries()].map(([cardDefId, quantity]) => ({ cardDefId, quantity })),
  };
  try {
    // Editing a loaded deck updates it; only fresh decks create a new entry.
    await api(state.deckId ? `/api/decks/${encodeURIComponent(state.deckId)}` : "/api/decks", {
      method: state.deckId ? "PUT" : "POST",
      body,
    });
    await refreshSavedDecks();
    showError("");
    $("deck-note").textContent = "✔ Saved!";
    $("deck-note").className = "validation-note ok";
  } catch (err) {
    showError(err.message);
  }
}

function loadSample(key) {
  const sample = SAMPLES[key];
  state.deckId = null;
  state.loom = [...sample.loom];
  state.deck = new Map(Object.entries(sample.cards));
  $("deck-name").value = sample.name;
  renderAll();
}

// ------------------------------------------------------------------ init

async function init() {
  const session = requireAuth();
  if (!session) return;
  renderAuthHeader();

  const { cards } = await api("/api/cards/catalog");
  state.catalog = cards;

  renderFilters();
  renderLoom();
  renderAll();
  await refreshSavedDecks();

  $("save-deck").addEventListener("click", () => void saveDeck());
  $("new-deck").addEventListener("click", () => {
    state.deckId = null;
    state.deck = new Map();
    $("deck-name").value = "";
    renderAll();
  });
  $("sample-growth").addEventListener("click", () => loadSample("growth"));
  $("sample-bulwark").addEventListener("click", () => loadSample("bulwark"));
}

init().catch((err) => showError(err.message));
