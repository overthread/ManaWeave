# Ruleset Integration Guide

Use this guide as soon as you share your exact game rules.

## 1. Create a concrete ruleset class

- File suggestion: `server/src/domain/rules/GmcRuleSet.ts`
- Implement `RuleSet`

Checklist:
- Define deck legality constraints
- Define initial life/energy/hand size
- Define mulligan logic (if any)
- Define phase transitions
- Define targeting constraints
- Define win/loss conditions

## 2. Model actions from your rules text

Map each allowed player intent to `GameAction` types.

Examples:
- play card
- declare attacker
- assign blocker
- activate effect
- end phase
- concede

## 3. Validate then apply

In `applyAction`:
- Validate action legality against current state and active player
- Apply changes immutably to produce next state
- Trigger and resolve effects in deterministic order
- Check winner and update terminal state

## 4. Determinism rules

- Inject RNG with a seed
- Keep effect resolution order explicit
- Avoid unordered iteration for game-critical logic
- Persist accepted action log for replay

## 5. Testing template

For each rule/card, add:
- One valid scenario test
- One invalid scenario test
- One edge-case scenario test

For phases, add:
- Allowed transition tests
- Forbidden transition tests

For win conditions, add:
- Each independent win condition
- Simultaneous defeat resolution behavior

## 6. Integration wiring

- Update composition root in `server/src/index.ts`
- Instantiate `GmcRuleSet`
- Pass it into use cases via dependency injection

## 7. Online play readiness checklist

- Server-authoritative validation complete
- Reconnect flow tested
- Action idempotency handled
- Timeouts/turn timers defined
- Abuse limits in transport layer
