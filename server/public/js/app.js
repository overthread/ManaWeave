/** Battle composition root: WS lifecycle, action submission, rendering. */
import { api, showError } from "./shared.js";
import { createGameView } from "./game-view.js";

const params = new URLSearchParams(location.search);
const gameId = params.get("gameId");
const playerId = params.get("playerId") ?? "p1";

if (!gameId) {
  location.replace("/lobby.html");
}

let busy = false;
let ws = null;

const gameView = createGameView({
  submitAction: async (partial) => {
    if (busy) return;
    busy = true;
    try {
      await api(`/api/games/${encodeURIComponent(gameId)}/actions`, {
        method: "POST",
        body: { ...partial, playerId },
      });
    } catch (err) {
      showError(err.message);
      gameView.cancelSelections();
    } finally {
      busy = false;
    }
  },
  toast: (message) => showError(message),
});

async function fetchView() {
  try {
    const { view } = await api(`/api/games/${encodeURIComponent(gameId)}?playerId=${encodeURIComponent(playerId)}`);
    gameView.render(view);
    return true;
  } catch (err) {
    showError(err.message);
    return false;
  }
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?gameId=${encodeURIComponent(gameId)}&playerId=${encodeURIComponent(playerId)}`);
  ws.addEventListener("message", (ev) => {
    let frame;
    try {
      frame = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (frame.event === "game_state") gameView.render(frame.payload);
  });
  ws.addEventListener("close", () => {
    setTimeout(connect, 900);
  });
}

document.getElementById("concede-btn").addEventListener("click", () => {
  if (!confirm("Concede the match?")) return;
  void api(`/api/games/${encodeURIComponent(gameId)}/actions`, {
    method: "POST",
    body: { type: "concede", playerId },
  }).catch((err) => showError(err.message));
});

document.getElementById("zone-viewer-close").addEventListener("click", () => gameView.closeZoneViewer());
document.getElementById("zone-viewer").addEventListener("click", (e) => {
  if (e.target.id === "zone-viewer") gameView.closeZoneViewer();
});

// In-battle rules summary ("?" in the header). Opens above play, dismisses
// the same ways as the pile viewer: button, scrim, or Escape.
const helpViewer = document.getElementById("help-viewer");
document.getElementById("help-btn").addEventListener("click", () => helpViewer.classList.add("visible"));
document.getElementById("help-close").addEventListener("click", () => helpViewer.classList.remove("visible"));
helpViewer.addEventListener("click", (e) => {
  if (e.target === helpViewer) helpViewer.classList.remove("visible");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    helpViewer.classList.remove("visible");
    gameView.cancelSelections();
  }
});

void fetchView().then((ok) => {
  if (ok) connect();
});
