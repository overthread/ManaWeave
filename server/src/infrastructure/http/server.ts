/**
 * Composition root — the only file that instantiates concrete classes.
 */

import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import { JsonDeckStore } from "../persistence/JsonDeckStore.js";
import { JsonAccountStore } from "../persistence/JsonAccountStore.js";
import { createTokenService } from "../../infrastructure/auth/tokens.js";
import { InMemoryGameRepository } from "../repositories/InMemoryGameRepository.js";
import { InMemoryGameEvents } from "../repositories/InMemoryGameEvents.js";
import { LoomRuleSet } from "../../domain/rules/LoomRuleSet.js";
import { setCardDefinitions } from "../../domain/card/CardDefinitions.js";
import { loadCardCatalogFromConfiguredCsvs } from "../cards/csvCatalog.js";
import { sanitizeStateForPlayer } from "../../domain/game/sanitize.js";
import { StartGameUseCase } from "../../application/use-cases/StartGameUseCase.js";
import { SubmitActionUseCase } from "../../application/use-cases/SubmitActionUseCase.js";
import { HANDLERS } from "./routes/index.js";
import type { RouteContext, RouteRequest } from "./routes/context.js";
import { ChannelSubscribers } from "../transport/channels.js";
import { attachWebSocketTransport } from "../transport/ws.js";
import { lobbyView } from "../lobby/LobbyState.js";

export async function startServer(opts: { baseDir: string; publicDir: string }): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? path.join(opts.baseDir, "data");
  await fsp.mkdir(dataDir, { recursive: true });
  const deckStore = new JsonDeckStore(dataDir);
  const accountStore = new JsonAccountStore(dataDir);
  const tokens = await createTokenService(dataDir);

  const catalog = await loadCardCatalogFromConfiguredCsvs();
  if (catalog.cards.length > 0) setCardDefinitions(catalog.cards);
  for (const warning of catalog.warnings) console.warn(`[catalog] ${warning}`);

  const gameRepository = new InMemoryGameRepository();
  const events = new InMemoryGameEvents();
  const ruleSet = new LoomRuleSet();
  const startGame = new StartGameUseCase(gameRepository, events, ruleSet);
  const submitAction = new SubmitActionUseCase(gameRepository, events, ruleSet);
  const lobbies = new Map<string, import("../lobby/LobbyState.js").LobbyState>();
  const channels = new ChannelSubscribers();

  const broadcastGameState = async (gameId: string): Promise<void> => {
    const state = await gameRepository.findById(gameId);
    if (!state) return;
    channels.forEach(`game:${gameId}`, (sub) => {
      if (!sub.playerId || !state.players[sub.playerId]) return;
      sub.send("game_state", sanitizeStateForPlayer(state, sub.playerId, ruleSet));
    });
  };

  const broadcastLobbyState = (roomCode: string): void => {
    const lobby = lobbies.get(roomCode);
    if (!lobby) return;
    channels.forEach(`lobby:${roomCode}`, (sub) => sub.send("lobby_state", lobbyView(lobby)));
  };

  events.bus.on("game_started", (s: { gameId: string }) => void broadcastGameState(s.gameId));
  events.bus.on("action_accepted", (p: { state: { gameId: string } }) => void broadcastGameState(p.state.gameId));
  events.bus.on("game_finished", (s: { gameId: string }) => void broadcastGameState(s.gameId));

  const context: RouteContext = {
    publicDir: opts.publicDir,
    deckStore,
    accountStore,
    tokens,
    gameRepository,
    ruleSet,
    startGame,
    submitAction,
    lobbies,
    channels,
    broadcastLobbyState,
    broadcastGameState,
  };

  const server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const req: RouteRequest = {
        method: request.method ?? "GET",
        pathname: requestUrl.pathname,
        request,
        response,
        requestUrl,
        context,
      };
      try {
        for (const handler of HANDLERS) {
          if (await handler(req)) return;
        }
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Not found." }));
      } catch (err) {
        console.error("[http]", err);
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal error." }));
        } else {
          response.end();
        }
      }
    })();
  });

  attachWebSocketTransport(server, context);

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`ManaWeave server listening on http://localhost:${port}`);
  });
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
// tsx runs from src/, compiled output from dist/ — prefer the layout that
// actually contains public/.
const baseDirCandidates = [path.resolve(thisDir, "../../.."), process.cwd()];
const foundBase = baseDirCandidates.find((d) => fs.existsSync(path.join(d, "public"))) ?? baseDirCandidates[0]!;
void startServer({ baseDir: foundBase, publicDir: path.join(foundBase, "public") });
