import type { GameRepository, GameEvents } from "../ports.js";
import { BattleEngine } from "../../domain/services/BattleEngine.js";
import type { RuleSet } from "../../domain/rules/RuleSet.js";
import type { GameState } from "../../domain/game/GameState.js";

export class StartGameUseCase {
  private readonly engine: BattleEngine;

  constructor(
    private readonly repo: GameRepository,
    private readonly events: GameEvents,
    ruleSet: RuleSet,
  ) {
    this.engine = new BattleEngine(ruleSet);
  }

  async execute(
    gameId: string,
    playerDecks: Record<string, readonly import("../../domain/card/Card.js").Card[]>,
    playerNames?: Record<string, string>,
    playerLooms?: Record<string, readonly import("../../domain/card/Card.js").ThreadColour[]>,
  ): Promise<GameState> {
    const state = this.engine.createNewGame(gameId, playerDecks, playerNames, playerLooms);
    await this.repo.save(state);
    await this.events.gameStarted(state);
    return state;
  }
}
