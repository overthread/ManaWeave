# OOSD Architecture for GMC TCG Battlesim

## Layering

- Domain layer
  - Pure game logic: entities, value objects, rules, actions
  - No framework, DB, or transport dependencies
- Application layer
  - Orchestrates use cases (`StartGameUseCase`, `SubmitActionUseCase`)
  - Depends on domain abstractions and port interfaces
- Infrastructure layer
  - Implementations for repository, transport, persistence, and external concerns
  - Depends on application/domain, never the other direction

## Core Design Patterns

- Strategy Pattern
  - `RuleSet` is a strategy for rule behavior
  - Swap formats/expansions by replacing the strategy implementation
- Command Pattern
  - `GameAction` represents user intent commands (`play_card`, `attack`, `end_turn`)
- Repository Pattern
  - `GameRepository` isolates storage details from application logic
- Event Publisher Pattern
  - `GameEvents` publishes state changes to online clients

## Why this helps

- New cards and effects are mostly additive
- Ruleset changes do not force transport or persistence rewrites
- Deterministic simulation is easier to test
- Match replay and rollback become straightforward

## Suggested Next Milestones

1. Ruleset v1 implementation
2. Deterministic RNG service
3. WebSocket adapter for real-time gameplay
4. Postgres or Redis persistence adapter
5. AI/simulation bot adapter using the same `GameAction` interface
