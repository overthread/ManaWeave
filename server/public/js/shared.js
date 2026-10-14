/** Shared client helpers: per-tab session, API wrapper (bearer auth), colours. */

export const SESSION_KEY = "manaweave.session";
export const LAST_USER_KEY = "manaweave.lastUser";
export const LOBBY_KEY = "manaweave.lobby";

/**
 * Sessions live in sessionStorage (per tab) on purpose: two tabs of the same
 * browser can be two different logged-in weavers, which is what makes
 * same-computer playtesting work. Refreshing a tab keeps its session.
 */
export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

export function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(LAST_USER_KEY, session.username ?? "");
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LOBBY_KEY);
}

export function getLastUsername() {
  return localStorage.getItem(LAST_USER_KEY) ?? "";
}

/** Each account's current room, in localStorage. Sessions are per tab, so a
 *  deck-builder round trip or a re-login in a fresh tab would otherwise lose
 *  the room; with this, the lobby re-enters it without asking for the code.
 *  Keyed by account id so two same-browser seats never pick up each other's
 *  room — matching the server, which re-seats joins by account. */
export function rememberRoom(accountId, roomCode) {
  if (accountId) localStorage.setItem(`manaweave.room.${accountId}`, roomCode);
}

export function getRememberedRoom(accountId) {
  return accountId ? localStorage.getItem(`manaweave.room.${accountId}`) : null;
}

export function forgetRoom(accountId) {
  if (accountId) localStorage.removeItem(`manaweave.room.${accountId}`);
}

/** Redirect to the login page unless this tab already has a session. */
export function requireAuth() {
  const session = getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login.html?next=${next}`);
    return null;
  }
  return session;
}

export function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  const session = getSession();
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
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

export async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* stateless tokens — local drop is enough */
  }
  clearSession();
  location.href = "/login.html";
}

/** Fill a header auth slot: display name + logout link (pages provide #auth-area). */
export function renderAuthHeader() {
  const el = document.getElementById("auth-area");
  if (!el) return;
  const session = getSession();
  if (!session) return;
  el.innerHTML = "";
  const who = document.createElement("span");
  who.className = "tag";
  who.textContent = session.displayName || session.username;
  const out = document.createElement("a");
  out.href = "#";
  out.textContent = "log out";
  out.style.marginLeft = "10px";
  out.addEventListener("click", (e) => {
    e.preventDefault();
    void logout();
  });
  el.append(who, out);
}

export const COLOURS = {
  ember: { label: "Ember", hex: "#ad3a28", glyph: "🔥" },
  tide: { label: "Tide", hex: "#31629e", glyph: "🌊" },
  verdant: { label: "Verdant", hex: "#47743f", glyph: "🌿" },
  umbra: { label: "Umbra", hex: "#6d4692", glyph: "🌙" },
  crimson: { label: "Crimson", hex: "#c8234c", glyph: "🌋" },
  azure: { label: "Azure", hex: "#4a90d9", glyph: "☁️" },
  neutral: { label: "Neutral", hex: "#857a63", glyph: "◇" },
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
