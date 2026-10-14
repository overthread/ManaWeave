/** Lobby composition root: create/join, roster, deck selection, chat, start.
 *  Sessions are per-tab, so two tabs of one browser = two weavers = local playtest. */
import { api, requireAuth, renderAuthHeader, getSession, showError, LOBBY_KEY, rememberRoom, getRememberedRoom, forgetRoom } from "./shared.js";

const state = {
  roomCode: null,
  playerId: null,
  playerKey: null,
  lobby: null,
  ws: null,
  decks: [],
};

const $ = (id) => document.getElementById(id);

async function refreshDecks() {
  if (!getSession()) return;
  const { decks } = await api("/api/decks");
  state.decks = decks;
  renderRoster();
}

function selectedDeckId(seat) {
  return state.lobby?.deckSelections?.[seat]?.deckId ?? "";
}

function renderRoster() {
  const roster = $("roster");
  roster.innerHTML = "";
  if (!state.lobby) return;
  for (const seat of state.lobby.players) {
    const row = document.createElement("div");
    row.className = "roster-row";

    const nameEl = document.createElement("strong");
    nameEl.textContent = `${seat.name}${seat.id === state.playerId ? " (you)" : ""}`;
    row.appendChild(nameEl);

    if (seat.id === state.playerId) {
      const select = document.createElement("select");
      select.style.flex = "1";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = state.decks.length === 0 ? "— no decks built yet —" : "— choose a deck —";
      select.appendChild(empty);
      for (const deck of state.decks) {
        const opt = document.createElement("option");
        opt.value = deck.id;
        opt.textContent = `${deck.name} (${deck.loom.join("/")})`;
        if (deck.id === selectedDeckId(seat.id)) opt.selected = true;
        select.appendChild(opt);
      }
      select.addEventListener("change", async () => {
        try {
          const { lobby } = await api(`/api/lobbies/${state.roomCode}/deck-selection`, {
            method: "POST",
            body: { playerId: state.playerId, playerKey: state.playerKey, deckId: select.value },
          });
          state.lobby = lobby;
          renderRoster();
        } catch (err) {
          showError(err.message);
        }
      });
      row.appendChild(select);
    } else {
      const sel = state.lobby.deckSelections?.[seat.id];
      const info = document.createElement("span");
      info.className = "muted";
      info.textContent = sel ? `deck: ${sel.deckName} (${sel.loom.join("/")})` : "no deck selected yet";
      row.appendChild(info);
    }
    roster.appendChild(row);
  }

  const bothReady = state.lobby.players.length === 2 && state.lobby.deckSelections?.p1 && state.lobby.deckSelections?.p2;
  $("start-btn").style.display = state.playerId === "p1" ? "" : "none";
  $("start-btn").disabled = !bothReady;
  $("start-hint").textContent =
    state.lobby.players.length < 2
      ? "Waiting for a second weaver…"
      : bothReady
        ? ""
        : "Both seats must pick a deck.";
  renderPlaytestHint();
}

/** Solo playtesting: open a second tab, log in as another weaver, join with the code. */
function renderPlaytestHint() {
  const hint = $("playtest-hint");
  if (!hint || !state.roomCode) return;
  hint.innerHTML = "";
  if (state.lobby.players.length >= 2) return;
  const text = document.createElement("span");
  text.className = "muted";
  text.style.fontSize = "13px";
  text.textContent = "Playtesting solo? Open a second seat in another tab of this browser";
  const link = document.createElement("a");
  link.href = `/login.html?switch=1&next=${encodeURIComponent(`/lobby.html?join=${state.roomCode}`)}`;
  link.target = "_blank";
  link.textContent = "→ open second seat";
  link.style.marginLeft = "6px";
  hint.append(text, link);
}

function renderChat() {
  const box = $("chat-messages");
  box.innerHTML = "";
  for (const msg of state.lobby?.messages ?? []) {
    const line = document.createElement("div");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = `${msg.senderName}: `;
    line.appendChild(who);
    line.appendChild(document.createTextNode(msg.text));
    box.appendChild(line);
  }
  box.scrollTop = box.scrollHeight;
}

function renderLobby(lobby) {
  state.lobby = lobby;
  if (lobby.status === "started" && lobby.gameId) {
    location.href = `/?gameId=${encodeURIComponent(lobby.gameId)}&playerId=${encodeURIComponent(state.playerId)}`;
    return;
  }
  $("room-panel").style.display = "";
  $("room-code").textContent = lobby.roomCode;
  $("chat-box").style.display = "";
  renderRoster();
  renderChat();
}

function connectWs() {
  if (state.ws) state.ws.close();
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws?mode=lobby&roomCode=${encodeURIComponent(state.roomCode)}&playerId=${encodeURIComponent(state.playerId)}`;
  const ws = new WebSocket(url);
  state.ws = ws;
  ws.addEventListener("message", (ev) => {
    let frame;
    try {
      frame = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (frame.event === "lobby_state") renderLobby(frame.payload);
  });
  ws.addEventListener("close", () => {
    if (state.roomCode) setTimeout(connectWs, 900);
  });
}

async function enterRoom(data) {
  state.roomCode = data.roomCode;
  state.playerId = data.playerId;
  state.playerKey = data.playerKey;
  state.lobby = data.lobby;
  sessionStorage.setItem(LOBBY_KEY, JSON.stringify({ roomCode: data.roomCode, playerId: data.playerId, playerKey: data.playerKey }));
  rememberRoom(getSession()?.accountId, data.roomCode);
  $("join-panel").style.display = "none";
  renderLobby(data.lobby);
  connectWs();
  void refreshDecks();
}

/** Re-enter this tab's room (refresh recovery), then the account's remembered
 *  room (fresh tab / after a re-login — the server re-seats joins by account).
 *  An explicit ?join= link must win over remembered rooms, so it can suppress
 *  the remembered fallback. */
async function tryResume(allowRemembered = true) {
  const saved = JSON.parse(sessionStorage.getItem(LOBBY_KEY) ?? "null");
  if (saved?.roomCode) {
    try {
      const lobby = await api(`/api/lobbies/${encodeURIComponent(saved.roomCode)}`);
      if (lobby.lobby.status === "started" && lobby.lobby.gameId) {
        location.href = `/?gameId=${encodeURIComponent(lobby.lobby.gameId)}&playerId=${encodeURIComponent(saved.playerId)}`;
        return true;
      }
      if (lobby.lobby.players.some((p) => p.id === saved.playerId)) {
        await enterRoom({ ...saved, lobby: lobby.lobby });
        return true;
      }
    } catch {
      sessionStorage.removeItem(LOBBY_KEY);
    }
  }
  if (allowRemembered) {
    const account = getSession();
    const roomCode = getRememberedRoom(account?.accountId);
    if (roomCode) {
      try {
        // Joining with our own account returns our existing seat.
        await joinRoom(roomCode);
        return true;
      } catch {
        forgetRoom(account.accountId);
      }
    }
  }
  return false;
}

async function joinRoom(code) {
  const data = await api(`/api/lobbies/${encodeURIComponent(code)}/join`, { method: "POST", body: {} });
  await enterRoom(data);
}

async function init() {
  const session = requireAuth();
  if (!session) return;
  renderAuthHeader();
  $("whoami").textContent = session.displayName || session.username;

  $("create-btn").addEventListener("click", async () => {
    try {
      const data = await api("/api/lobbies", { method: "POST", body: {} });
      await enterRoom(data);
    } catch (err) {
      showError(err.message);
    }
  });

  $("join-btn").addEventListener("click", async () => {
    const code = $("join-code").value.trim().toUpperCase();
    if (!code) return;
    try {
      await joinRoom(code);
    } catch (err) {
      showError(err.message);
    }
  });

  $("start-btn").addEventListener("click", async () => {
    try {
      const data = await api(`/api/lobbies/${state.roomCode}/start`, {
        method: "POST",
        body: { playerId: state.playerId, playerKey: state.playerKey },
      });
      location.href = `/?gameId=${encodeURIComponent(data.gameId)}&playerId=${encodeURIComponent(state.playerId)}`;
    } catch (err) {
      showError(err.message);
    }
  });

  const sendChat = () => {
    const text = $("chat-input").value.trim();
    if (!text || state.ws?.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({ event: "chat_send", payload: { text } }));
    $("chat-input").value = "";
  };
  $("chat-send").addEventListener("click", sendChat);
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  // Resumed straight into a room? Otherwise auto-join when arriving via a
  // second-seat playtest link (?join=CODE). The link outranks a remembered
  // room; only this tab's own room can pre-empt it.
  const autoJoin = new URLSearchParams(location.search).get("join")?.trim().toUpperCase();
  const resumed = await tryResume(!autoJoin);
  if (!resumed && autoJoin) {
    try {
      await joinRoom(autoJoin);
    } catch (err) {
      showError(err.message);
    }
  }
}

init();
