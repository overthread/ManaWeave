import type { GameRepository, GameEvents } from "../ports.js";
import { BattleEngine } from "../../domain/services/BattleEngine.js";
import type { RuleSet } from "../../domain/rules/RuleSet.js";
import type { GameAction } from "../../domain/actions/GameAction.js";
import { GameRuleViolationError } from "../../domain/rules/GameRuleViolationError.js";

export class SubmitActionUseCase {
  private readonly engine: BattleEngine;

  constructor(
    private readonly repo: GameRepository,
    private readonly events: GameEvents,
    ruleSet: RuleSet,
  ) {
    this.engine = new BattleEngine(ruleSet);
  }

  async execute(action: GameAction): Promise<void> {
    const state = await this.repo.findById(action.gameId);
    if (!state) throw new GameRuleViolationError("Game not found.");
    const next = this.engine.submitAction(state, action);
    await this.repo.save(next);
    await this.events.actionAccepted(action, next);
    if (next.winnerPlayerId) await this.events.gameFinished(next);
  }
}
