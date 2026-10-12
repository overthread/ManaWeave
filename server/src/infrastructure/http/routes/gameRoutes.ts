import crypto from "node:crypto";
import { writeJson, readBody } from "../http-utils.js";
import type { RouteHandler } from "./context.js";
import type { GameAction } from "../../../domain/actions/GameAction.js";
import { sanitizeStateForPlayer } from "../../../domain/game/sanitize.js";
import { GameRuleViolationError } from "../../../domain/rules/GameRuleViolationError.js";
import { buildDemoPlayerDecks } from "../../cards/demoDecks.js";
import { createCardFromDefinition } from "../../../domain/card/CardDefinitions.js";
import type { ThreadColour } from "../../../domain/card/Card.js";

export const handleGameRoutes: RouteHandler = async ({ method, pathname, request, response, requestUrl, context }): Promise<boolean> => {
  const { gameRepository, submitAction, deckStore, startGame } = context;
  let m: RegExpMatchArray | null;

  // Direct game creation (testing / quick play). Uses persisted decks when given,
  // otherwise falls back to two demo decks.
  if (method === "POST" && pathname === "/api/games") {
    const body = await readBody<{ p1DeckId?: string; p2DeckId?: string; p1ProfileId?: string; p2ProfileId?: string }>(request);
    let decks: Record<string, import("../../../domain/card/Card.js").Card[]>;
    let looms: Record<string, ThreadColour[]>;
    let names: Record<string, string>;
    if (body.p1DeckId && body.p2DeckId && body.p1ProfileId && body.p2ProfileId) {
      const d1 = await deckStore.getDeckByIdForPlayer(body.p1ProfileId, body.p1DeckId);
      const d2 = await deckStore.getDeckByIdForPlayer(body.p2ProfileId, body.p2DeckId);
      if (!d1 || !d2) {
        writeJson(response, 404, { error: "Deck not found." });
        return true;
      }
      const expand = (d: typeof d1) => d.cards.flatMap(({ cardDefId, quantity }) => Array.from({ length: quantity }, () => createCardFromDefinition(cardDefId, cardDefId)));
      decks = { p1: expand(d1), p2: expand(d2) };
      looms = { p1: [...d1.loom], p2: [...d2.loom] };
      names = { p1: "Weaver 1", p2: "Weaver 2" };
    } else {
      const demo = buildDemoPlayerDecks();
      decks = demo.decks;
      looms = demo.looms;
      names = demo.names;
    }
    const gameId = crypto.randomUUID();
    try {
      await startGame.execute(gameId, decks, names, looms);
    } catch (err) {
      writeJson(response, 400, { error: err instanceof Error ? err.message : "Failed to create game." });
      return true;
    }
    writeJson(response, 200, { gameId, playerIds: ["p1", "p2"] });
    return true;
  }

  m = pathname.match(/^\/api\/games\/([^/]+)$/);
  if (m && method === "GET") {
    const state = await gameRepository.findById(decodeURIComponent(m[1]!));
    if (!state) {
      writeJson(response, 404, { error: "Game not found." });
      return true;
    }
    const playerId = requestUrl.searchParams.get("playerId") ?? "p1";
    if (!state.players[playerId]) {
      writeJson(response, 400, { error: "playerId must be a seat in this game." });
      return true;
    }
    writeJson(response, 200, { view: sanitizeStateForPlayer(state, playerId, context.ruleSet) });
    return true;
  }

  m = pathname.match(/^\/api\/games\/([^/]+)\/actions$/);
  if (m && method === "POST") {
    const gameId = decodeURIComponent(m[1]!);
    const body = await readBody<Partial<GameAction>>(request);
    const action = { ...body, gameId, type: body.type, playerId: body.playerId } as GameAction;
    if (typeof action.type !== "string" || typeof action.playerId !== "string") {
      writeJson(response, 400, { error: "Action needs type and playerId." });
      return true;
    }
    try {
      await submitAction.execute(action);
    } catch (err) {
      const status = err instanceof GameRuleViolationError ? 400 : 500;
      writeJson(response, status, { error: err instanceof Error ? err.message : "Action failed." });
      return true;
    }
    const state = await gameRepository.findById(gameId);
    writeJson(response, 200, { ok: true, winnerPlayerId: state?.winnerPlayerId ?? null });
    return true;
  }

  // SSE fallback for environments where WebSocket is unavailable.
  m = pathname.match(/^\/api\/games\/([^/]+)\/stream$/);
  if (m && method === "GET") {
    const gameId = decodeURIComponent(m[1]!);
    const playerId = requestUrl.searchParams.get("playerId") ?? "p1";
    const state = await gameRepository.findById(gameId);
    if (!state || !state.players[playerId]) {
      writeJson(response, 404, { error: "Game/player not found." });
      return true;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const sub = {
      playerId,
      send: (event: string, payload: unknown) => {
        response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      },
    };
    sub.send("ready", { ok: true, mode: "game", gameId, playerId });
    sub.send("game_state", sanitizeStateForPlayer(state, playerId, context.ruleSet));
    context.channels.add(`game:${gameId}`, sub);
    request.on("close", () => context.channels.remove(`game:${gameId}`, sub));
    return true;
  }

  return false;
};
