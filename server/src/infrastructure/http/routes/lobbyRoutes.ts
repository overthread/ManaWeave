import crypto from "node:crypto";
import { writeJson, readBody } from "../http-utils.js";
import type { RouteHandler } from "./context.js";
import { createLobby, lobbyView } from "../../lobby/LobbyState.js";
import { createCardFromDefinition } from "../../../domain/card/CardDefinitions.js";
import type { ThreadColour } from "../../../domain/card/Card.js";

function requireKey(lobby: import("../../lobby/LobbyState.js").LobbyState, playerId: string, playerKey: unknown): boolean {
  return typeof playerKey === "string" && lobby.playerSessionKeys[playerId] === playerKey;
}

export const handleLobbyRoutes: RouteHandler = async ({ method, pathname, request, response, requestUrl, context }): Promise<boolean> => {
  const { lobbies, deckStore, startGame, broadcastLobbyState } = context;
  let m: RegExpMatchArray | null;

  if (method === "POST" && pathname === "/api/lobbies") {
    const body = await readBody<{ name?: string }>(request);
    const lobby = createLobby(typeof body.name === "string" ? body.name : "Host");
    lobbies.set(lobby.roomCode, lobby);
    writeJson(response, 200, {
      roomCode: lobby.roomCode,
      playerId: "p1",
      playerKey: lobby.playerSessionKeys.p1,
      lobby: lobbyView(lobby),
    });
    return true;
  }

  m = pathname.match(/^\/api\/lobbies\/([A-Za-z0-9]+)$/);
  if (m && method === "GET") {
    const lobby = lobbies.get(m[1]!.toUpperCase());
    if (!lobby) {
      writeJson(response, 404, { error: "Room not found." });
      return true;
    }
    writeJson(response, 200, { lobby: lobbyView(lobby) });
    return true;
  }

  m = pathname.match(/^\/api\/lobbies\/([A-Za-z0-9]+)\/join$/);
  if (m && method === "POST") {
    const lobby = lobbies.get(m[1]!.toUpperCase());
    if (!lobby) {
      writeJson(response, 404, { error: "Room not found." });
      return true;
    }
    const body = await readBody<{ name?: string }>(request);
    const name = (typeof body.name === "string" && body.name.trim()) ? body.name.trim().slice(0, 40) : "Challenger";
    // Same-name join returns the existing seat (refresh recovery).
    const existing = lobby.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      writeJson(response, 200, { roomCode: lobby.roomCode, playerId: existing.id, playerKey: lobby.playerSessionKeys[existing.id], lobby: lobbyView(lobby) });
      return true;
    }
    if (lobby.status === "started" || lobby.players.length >= 2) {
      writeJson(response, 409, { error: "Room is full or already started." });
      return true;
    }
    lobby.players.push({ id: "p2", name });
    lobby.playerSessionKeys.p2 = crypto.randomBytes(16).toString("hex");
    broadcastLobbyState(lobby.roomCode);
    writeJson(response, 200, { roomCode: lobby.roomCode, playerId: "p2", playerKey: lobby.playerSessionKeys.p2!, lobby: lobbyView(lobby) });
    return true;
  }

  m = pathname.match(/^\/api\/lobbies\/([A-Za-z0-9]+)\/deck-selection$/);
  if (m && method === "POST") {
    const lobby = lobbies.get(m[1]!.toUpperCase());
    if (!lobby) {
      writeJson(response, 404, { error: "Room not found." });
      return true;
    }
    const body = await readBody<{ playerId?: string; playerKey?: string; deckPlayerId?: string; deckId?: string }>(request);
    const seat = body.playerId === "p1" || body.playerId === "p2" ? body.playerId : null;
    if (!seat || !lobby.players.some((p) => p.id === seat)) {
      writeJson(response, 400, { error: "Invalid seat." });
      return true;
    }
    if (!requireKey(lobby, seat, body.playerKey)) {
      writeJson(response, 403, { error: "Bad player key." });
      return true;
    }
    if (lobby.status === "started") {
      writeJson(response, 409, { error: "Match already started." });
      return true;
    }
    if (!body.deckPlayerId || !body.deckId) {
      delete lobby.deckSelections[seat];
      broadcastLobbyState(lobby.roomCode);
      writeJson(response, 200, { lobby: lobbyView(lobby) });
      return true;
    }
    const deck = await deckStore.getDeckByIdForPlayer(body.deckPlayerId, body.deckId);
    if (!deck) {
      writeJson(response, 404, { error: "Deck not found for that player." });
      return true;
    }
    lobby.deckSelections[seat] = {
      playerProfileId: body.deckPlayerId,
      deckId: deck.id,
      deckName: deck.name,
      loom: [...deck.loom],
      selectedAt: Date.now(),
    };
    broadcastLobbyState(lobby.roomCode);
    writeJson(response, 200, { lobby: lobbyView(lobby) });
    return true;
  }

  m = pathname.match(/^\/api\/lobbies\/([A-Za-z0-9]+)\/start$/);
  if (m && method === "POST") {
    const lobby = lobbies.get(m[1]!.toUpperCase());
    if (!lobby) {
      writeJson(response, 404, { error: "Room not found." });
      return true;
    }
    const body = await readBody<{ playerId?: string; playerKey?: string }>(request);
    if (body.playerId !== "p1" || !requireKey(lobby, "p1", body.playerKey)) {
      writeJson(response, 403, { error: "Only the host can start the match." });
      return true;
    }
    if (lobby.status === "started") {
      writeJson(response, 409, { error: "Match already started." });
      return true;
    }
    if (lobby.players.length < 2 || !lobby.deckSelections.p1 || !lobby.deckSelections.p2) {
      writeJson(response, 400, { error: "Both seats need a deck before starting." });
      return true;
    }

    const playerDecks: Record<string, import("../../../domain/card/Card.js").Card[]> = {};
    const playerLooms: Record<string, ThreadColour[]> = {};
    const playerNames: Record<string, string> = {};
    for (const seat of ["p1", "p2"] as const) {
      const sel = lobby.deckSelections[seat]!;
      const deck = await deckStore.getDeckByIdForPlayer(sel.playerProfileId, sel.deckId);
      if (!deck) {
        writeJson(response, 400, { error: `Seat ${seat}'s deck no longer exists.` });
        return true;
      }
      const cards: import("../../../domain/card/Card.js").Card[] = [];
      for (const { cardDefId, quantity } of deck.cards) {
        for (let i = 0; i < quantity; i++) cards.push(createCardFromDefinition(cardDefId, cardDefId));
      }
      playerDecks[seat] = cards;
      playerLooms[seat] = [...deck.loom];
      const seatPlayer = lobby.players.find((p) => p.id === seat);
      playerNames[seat] = seatPlayer?.name ?? seat;
    }

    const gameId = crypto.randomUUID();
    try {
      await startGame.execute(gameId, playerDecks, playerNames, playerLooms);
    } catch (err) {
      writeJson(response, 400, { error: err instanceof Error ? err.message : "Failed to start game." });
      return true;
    }
    lobby.status = "started";
    lobby.gameId = gameId;
    broadcastLobbyState(lobby.roomCode);
    writeJson(response, 200, { gameId, lobby: lobbyView(lobby) });
    return true;
  }

  void requestUrl;
  return false;
};
