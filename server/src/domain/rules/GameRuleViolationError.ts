export class GameRuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameRuleViolationError";
  }
}
