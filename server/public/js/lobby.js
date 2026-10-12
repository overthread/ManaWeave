/** Lobby composition root: create/join, roster, deck selection, chat, start. */
import { api, ensureProfile, getSession, showError } from "./shared.js";

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
  const session = getSession();
  if (!session) return;
  const { decks } = await api(`/api/players/${encodeURIComponent(session.profileId)}/decks`);
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
          const session = getSession();
          const { deckPlayerId, deckId } = select.value
            ? { deckPlayerId: session.profileId, deckId: select.value }
            : { deckPlayerId: "", deckId: "" };
          const { lobby } = await api(`/api/lobbies/${state.roomCode}/deck-selection`, {
            method: "POST",
            body: { playerId: state.playerId, playerKey: state.playerKey, deckPlayerId, deckId },
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
  localStorage.setItem("manaweave.lobby", JSON.stringify({ roomCode: data.roomCode, playerId: data.playerId, playerKey: data.playerKey }));
  $("join-panel").style.display = "none";
  renderLobby(data.lobby);
  connectWs();
  void refreshDecks();
}

async function tryResume() {
  const saved = JSON.parse(localStorage.getItem("manaweave.lobby") ?? "null");
  if (!saved?.roomCode) return false;
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
    localStorage.removeItem("manaweave.lobby");
  }
  return false;
}

function init() {
  const session = getSession();
  $("whoami").textContent = session?.name ?? "";
  $("name-input").value = session?.name ?? "";

  $("save-name").addEventListener("click", async () => {
    const name = $("name-input").value.trim();
    if (!name) return;
    const s = await ensureProfile(name);
    $("whoami").textContent = s.name;
  });

  $("create-btn").addEventListener("click", async () => {
    try {
      await ensureProfile($("name-input").value.trim());
      const data = await api("/api/lobbies", { method: "POST", body: { name: $("name-input").value.trim() || "Host" } });
      await enterRoom(data);
    } catch (err) {
      showError(err.message);
    }
  });

  $("join-btn").addEventListener("click", async () => {
    const code = $("join-code").value.trim().toUpperCase();
    if (!code) return;
    try {
      await ensureProfile($("name-input").value.trim());
      const data = await api(`/api/lobbies/${encodeURIComponent(code)}/join`, {
        method: "POST",
        body: { name: $("name-input").value.trim() || "Challenger" },
      });
      await enterRoom(data);
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

  void tryResume();
}

init();
