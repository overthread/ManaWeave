import type { IncomingMessage } from "node:http";
import type { ServerResponse } from "node:http";
import type { AsyncPlayerDeckStore } from "../../../application/ports.js";
import type { InMemoryGameRepository } from "../../repositories/InMemoryGameRepository.js";
import type { LoomRuleSet } from "../../../domain/rules/LoomRuleSet.js";
import type { StartGameUseCase } from "../../../application/use-cases/StartGameUseCase.js";
import type { SubmitActionUseCase } from "../../../application/use-cases/SubmitActionUseCase.js";
import type { LobbyState } from "../../lobby/LobbyState.js";
import type { ChannelSubscribers } from "../../transport/channels.js";

export interface RouteContext {
  publicDir: string;
  deckStore: AsyncPlayerDeckStore;
  gameRepository: InMemoryGameRepository;
  ruleSet: LoomRuleSet;
  startGame: StartGameUseCase;
  submitAction: SubmitActionUseCase;
  lobbies: Map<string, LobbyState>;
  channels: ChannelSubscribers;
  broadcastLobbyState: (roomCode: string) => void;
  broadcastGameState: (gameId: string) => Promise<void>;
}

export interface RouteRequest {
  method: string;
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  context: RouteContext;
}

export type RouteHandler = (req: RouteRequest) => Promise<boolean>;

export interface DeckRequestBody {
  name?: unknown;
  format?: unknown;
  loom?: unknown;
  cards?: unknown;
}
