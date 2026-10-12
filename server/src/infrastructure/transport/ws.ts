/**
 * One /ws endpoint multiplexed by query params:
 *   ?gameId=G&playerId=p1        game channel (per-player sanitized pushes)
 *   ?mode=lobby&roomCode=R       lobby channel (roster/chat/deck-selection)
 * Existence + seat are validated BEFORE the handshake upgrade.
 */

import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { RouteContext } from "../http/routes/context.js";
import { lobbyView, pushLobbyMessage } from "../lobby/LobbyState.js";
import { sanitizeStateForPlayer } from "../../domain/game/sanitize.js";

interface PendingSub {
  playerId?: string;
  send: (event: string, payload: unknown) => void;
}

export function attachWebSocketTransport(server: Server, context: RouteContext): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: import("node:http").IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    void (async () => {
      let channel: string | null = null;
      let playerId: string | undefined;

      const gameId = url.searchParams.get("gameId");
      const mode = url.searchParams.get("mode");
      if (gameId) {
        playerId = url.searchParams.get("playerId") ?? undefined;
        const state = await context.gameRepository.findById(gameId);
        if (!state || !playerId || !state.players[playerId]) {
          socket.destroy();
          return;
        }
        channel = `game:${gameId}`;
      } else if (mode === "lobby") {
        const roomCode = (url.searchParams.get("roomCode") ?? "").toUpperCase();
        const lobby = context.lobbies.get(roomCode);
        if (!lobby) {
          socket.destroy();
          return;
        }
        playerId = url.searchParams.get("playerId") ?? undefined;
        if (playerId && !lobby.players.some((p) => p.id === playerId)) playerId = undefined;
        channel = `lobby:${roomCode}`;
      } else {
        socket.destroy();
        return;
      }

      const chosen = channel;
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        const sub: PendingSub = {
          playerId,
          send: (event, payload) => {
            if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event, payload }));
          },
        };
        context.channels.add(chosen, sub);
        ws.on("close", () => context.channels.remove(chosen, sub));
        ws.on("error", () => context.channels.remove(chosen, sub));

        if (chosen.startsWith("game:")) {
          sub.send("ready", { ok: true, mode: "game", gameId: chosen.slice(5), playerId });
          void context.gameRepository.findById(chosen.slice(5)).then((state) => {
            if (state && playerId) sub.send("game_state", sanitizeStateForPlayer(state, playerId, context.ruleSet));
          });
        } else {
          const lobby = context.lobbies.get(chosen.slice(6));
          sub.send("ready", { ok: true, mode: "lobby", roomCode: chosen.slice(6), playerId: playerId ?? null });
          if (lobby) sub.send("lobby_state", lobbyView(lobby));
          ws.on("message", (raw) => {
            let frame: { event?: unknown; payload?: unknown };
            try {
              frame = JSON.parse(String(raw)) as { event?: unknown; payload?: unknown };
            } catch {
              return;
            }
            if (frame.event !== "chat_send") return;
            const text = (frame.payload as { text?: unknown } | null)?.text;
            const seat = lobby?.players.find((p) => p.id === sub.playerId);
            if (!lobby || !seat || typeof text !== "string") {
              sub.send("chat_error", { error: "Invalid chat message." });
              return;
            }
            pushLobbyMessage(lobby, seat.id, seat.name, text);
            context.broadcastLobbyState(lobby.roomCode);
          });
        }
      });
    })();
  });
}
