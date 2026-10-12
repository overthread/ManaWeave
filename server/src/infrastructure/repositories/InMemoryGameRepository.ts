import type { GameRepository } from "../../application/ports.js";
import type { GameState } from "../../domain/game/GameState.js";

export class InMemoryGameRepository implements GameRepository {
  private readonly games = new Map<string, GameState>();

  async save(state: GameState): Promise<void> {
    this.games.set(state.gameId, state);
  }

  async findById(id: string): Promise<GameState | undefined> {
    return this.games.get(id);
  }
}
