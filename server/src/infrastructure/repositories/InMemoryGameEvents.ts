import type { GameEvents } from "../../application/ports.js";
import { EventEmitter } from "node:events";

/**
 * Domain events fan out over an EventEmitter; the composition root subscribes
 * and translates them into per-player WebSocket pushes.
 */
export class InMemoryGameEvents implements GameEvents {
  readonly bus = new EventEmitter();

  async gameStarted(state: import("../../domain/game/GameState.js").GameState): Promise<void> {
    this.bus.emit("game_started", { gameId: state.gameId });
  }

  async actionAccepted(action: import("../../domain/actions/GameAction.js").GameAction, state: import("../../domain/game/GameState.js").GameState): Promise<void> {
    this.bus.emit("action_accepted", { state });
  }

  async gameFinished(state: import("../../domain/game/GameState.js").GameState): Promise<void> {
    this.bus.emit("game_finished", { gameId: state.gameId });
  }
}
