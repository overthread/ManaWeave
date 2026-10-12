# Ruleset Authoring & Hardening

The ruleset is the only game-specific class. Everything else in the stack is generic. Write it in this order.

## Recipe

### 1. Constants + metadata types

```ts
export const SCORE_SEQUENCE = [1, 1, 1, 2, 2, 4] as const;
export const SCORE_TO_WIN = 6;
type ScoreMetadata = { sequence: number[]; claimedByPlayer: Record<string, number> };
```

### 2. Metadata rehydration helpers (one per metadata key)

State extras (score piles, setup counters, lane picks, revealed cards) live in `state.metadata` as plain JSON. Never read them directly — write `parseXMetadata(value: unknown): XMetadata | null` that validates every field, clamps numbers (`Math.max(0, Math.floor(...))`), and returns null on shape mismatch. Both the ruleset AND the presentation layer use these helpers, so views survive metadata drift.

### 3. `validateDeck`

Size bounds + copy limits + format/symbol constraints. Return `{ok: false, reason}` with a human-readable message — it reaches players verbatim.

### 4. `initializeGame`

- Require the expected player count; throw otherwise.
- Re-stamp every deck card with a unique instance id: `${playerId}-${index + 1}-${card.id}`, preserving the definition id in `metadata.baseCardId`.
- Shuffle (inject a seedable RNG — see hardening), deal opening hands, set starting life/resources.
- Seed every metadata key (setup counters, score piles) and set the starting phase (`"setup"` if you have a scripted opening, else the first real phase).

### 5. `listLegalActions` — legality as data

Enumerate EVERYTHING the player may do right now as fully-formed actions (with real card ids, lanes, targets):

- Always-legal first: `concede`, plus any free verbs.
- Per-zone sweeps: for each card in hand -> play actions (one per lane/target), discard, etc.; for each battlefield unit -> attack/ability actions; graveyard/exile/deck sweeps for move-style verbs.
- Phase gates: setup-phase actions only during setup; phase-advance actions (`phase_produce`, ...) when their phase is current; turn-bound verbs only emitted for `state.turnPlayerId` (the engine double-checks this, but don't offer what's illegal).
- Cap combinatorial explosions (attach: only when >= 2 candidates exist).

The UI renders buttons straight from this list — the shape of your game's HUD is decided here.

### 6. `applyAction` — clone then switch

```ts
applyAction(state, action) {
  const next = this.cloneState(state);
  switch (action.type) {
    case "play_card": { /* find in hand (throw GameRuleViolationError if absent),
                          splice out, re-stamp Card with zone/lane metadata, push to battlefield */ }
    case "end_turn":  { /* rotate turnPlayerId, turnNumber += 1, set next phase,
                          per-player cleanup: reset stat bonuses, expire temporary cards,
                          clear per-turn metadata (lane picks, ...), draw for next player */ }
    // one case per verb; throw GameRuleViolationError on any precondition failure
    default: return next;
  }
}
```

Discipline: mutate only `next`; replace cards immutably (`new Card(...)` with spread metadata) when their stats change; use metadata fields (`power`, `powerBonus`, `zone`, `tapped`, `attachments`) to track transient state, and reset bonuses in the turn-cleanup case. End-of-turn cleanup IS an action case — don't hide it in a side effect.

### 7. `getWinner` — ALL win conditions

Explicit `winnerPlayerId` (concede) first; then each independent condition (score threshold, life <= 0 with last-player-standing resolution for simultaneous defeats); `undefined` otherwise. The engine stamps the result; you never set `winnerPlayerId` in `applyAction` except for concede.

## Testing template (domain-level, no I/O needed)

- Per rule/card: one valid, one invalid, one edge case.
- Per phase transition: allowed AND forbidden transitions.
- Per win condition: reach it, plus simultaneous-defeat behavior.
- Legality fuzz: a random valid-looking action that isn't in `listLegalActions` must throw.

## Production hardening checklist

| Gap in the reference implementation | Fix before real players |
|---|---|
| `Math.random()` shuffle | Inject seedable RNG; log seed + accepted action log -> deterministic replay/audit |
| Games in-memory only (restart = lost matches) | Persist `GameState` or (seed + action log) via `GameRepository` |
| No turn timers | Server-side per-phase deadlines + auto-pass/forfeit |
| No disconnect handling | Reconnect grace window; mark idle player; allow rejoin via playerKey |
| No idempotency/rate limits | Action sequence numbers; per-connection throttle |
| `playerKey` is weak auth; identity = display name | Real accounts/sessions/tokens |
| Dual deck validation (route vs ruleset) | Shared constants module |
| No test suite | Testing template above, wired into CI |

## Deployment

- Any PaaS with a port + persistent disk. Render example: web service, `rootDir: server`, build `npm ci --include=dev && npm run build`, start `node dist/index.js`, health `/api/health`, disk mounted at `DATA_DIR`, env vars `PORT`, `DATABASE_URL` (optional, switches to Postgres), `CARD_CSV_*_URL` per category.
- WebSockets need the host to support them (Render does; serverless platforms need extra work).
- If card data lives in Google Sheets: File -> Share -> Publish to web -> per-sheet CSV, paste URLs into env vars. Card balance changes deploy on restart with zero code changes.
