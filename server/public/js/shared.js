/** Shared client helpers: session, API wrapper, colours. */

export const SESSION_KEY = "manaweave.session";

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

export function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Ensure a player profile exists (stored in localStorage for refresh recovery). */
export async function ensureProfile(preferredName) {
  let session = getSession();
  const name = preferredName || session?.name || `Weaver ${Math.floor(Math.random() * 900 + 100)}`;
  const { player } = await api("/api/players", { method: "POST", body: { id: session?.profileId, name } });
  session = { profileId: player.id, name: player.displayName };
  setSession(session);
  return session;
}

export const COLOURS = {
  ember: { label: "Ember", hex: "#e0563a", glyph: "🔥" },
  tide: { label: "Tide", hex: "#3a9ad9", glyph: "🌊" },
  verdant: { label: "Verdant", hex: "#4caf6d", glyph: "🌿" },
  umbra: { label: "Umbra", hex: "#9a5bd9", glyph: "🌙" },
  neutral: { label: "Neutral", hex: "#b9b3c7", glyph: "◇" },
};

export const ORIENTATION_ARROWS = ["↑", "→", "↓", "←"];
export const ORIENTATION_NAMES = ["up", "right", "down", "left"];
export const ORIENTATION_INDEX = { up: 0, right: 1, down: 2, left: 3 };

const entryColour = (e) => COLOURS[e?.colour]?.hex ?? COLOURS.neutral.hex;
const entryArrow = (e) => ORIENTATION_ARROWS[ORIENTATION_INDEX[e?.orientation] ?? 0] ?? "?";

/** Render a cost ([{colour:"ember",orientation:"up"},...]) as coloured arrow spans (for innerHTML). */
export function formatCostHtml(cost) {
  if (!Array.isArray(cost) || cost.length === 0) return "free";
  return cost.map((e) => `<span class="oc" style="color:${entryColour(e)}">${entryArrow(e)}</span>`).join("");
}

/** Plain-text rendering (for titles/tooltips): "ember↑ ember←". */
export function formatCostText(cost) {
  if (!Array.isArray(cost) || cost.length === 0) return "free";
  return cost.map((e) => `${e.colour ?? "any"}${entryArrow(e)}`).join(" ");
}

export function showError(message) {
  const el = document.getElementById("error-banner");
  if (!el) return;
  el.textContent = message;
  el.style.display = "block";
  setTimeout(() => {
    el.style.display = "none";
  }, 5000);
}
