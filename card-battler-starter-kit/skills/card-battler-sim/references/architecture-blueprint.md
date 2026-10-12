# Architecture Blueprint

Module responsibilities and copy-ready skeletons for the game-agnostic shell. TypeScript ESM; imports use `.js` extensions (compiled output convention).

## Composition root (`src/infrastructure/http/server.ts`)

The ONLY place concrete classes are instantiated:

```ts
export async function startServer(opts: { baseDir: string; publicDir: string }) {
  const deckStore = await createPlayerDeckStore(baseDir);      // sqlite | postgres
  const catalog = await loadCardCatalogFromConfiguredCsvs();   // CSV -> CardDefinitions
  if (catalog.cards.length > 0) setCardDefinitions(catalog.cards);

  const gameRepository = new InMemoryGameRepository();
  const events = new InMemoryGameEvents();
  const ruleSet = new YourRuleSet();                           // <-- swap per game
  const startGame = new StartGameUseCase(gameRepository, events, ruleSet);
  const submitAction = new SubmitActionUseCase(gameRepository, events, ruleSet);
  const lobbies = new Map<string, LobbyState>();
  const socketSubscribers = new Map<string, Set<SocketSubscriber>>();

  const broadcastGameState = async (gameId: string) => {
    const state = await gameRepository.findById(gameId);
    if (!state) return;
    socketSubscribers.get(gameId)?.forEach((sub) => {
      if (!state.players[sub.playerId]) return;
      writeWsEvent(sub.socket, "game_state", sanitizeStateForPlayer(state, sub.playerId, ruleSet));
    });
  };

  events.bus.on("game_started",   (s) => void broadcastGameState(s.gameId));
  events.bus.on("action_accepted", (p) => void broadcastGameState(p.state.gameId));
  events.bus.on("game_finished",  (s) => void broadcastGameState(s.gameId));

  const server = createServer((req, res) => handleHttpRoute({...}));  // route chain
  attachWebSocketTransport({ server, gameRepository, ruleSet, lobbies, socketSubscribers, ... });
  server.listen(Number(process.env.PORT ?? 3000));
}
```

## Domain files

### `domain/card/Card.ts` + `CardDefinitions.ts`

```ts
export class Card {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: "unit" | "spell" | "artifact" | "skill",
    public readonly stats: { attack: number; health: number; cost: number },
    public readonly effects: readonly Effect[] = [],
    public readonly metadata: Readonly<Record<string, unknown>> = {}
  ) {}
  clone(): Card { /* deep-copy stats/effects/metadata into a new Card */ }
}

export type CardDefinition = {
  id: string; title: string; type: CardType;
  attack: number; health: number; cost: number;
  category: string; rarity?: string; description?: string; copies?: number; /* presentation fields */
};

let definitions: CardDefinition[] = [...FALLBACK_CATALOG];
export function setCardDefinitions(defs: readonly CardDefinition[]) { /* normalize + replace */ }
export function listCardDefinitions(): readonly CardDefinition[] { return definitions; }
export function createCardFromDefinition(cardDefId: string, uniqueId: string): Card {
  // stamp definition into an instance; copy display/rules fields into metadata:
  // { title, power: attack, intellect: health, cost, phase, rarity, classColor, baseCardId: cardDefId }
}
```

### `domain/game/GameState.ts`

```ts
export interface PlayerState {
  id: string; life: number; energy: number;
  deck: Card[]; hand: Card[]; battlefield: Card[]; graveyard: Card[]; exile: Card[];
}
export interface GameState {
  gameId: string;
  players: Record<string, PlayerState>;
  turnPlayerId: string; turnNumber: number; phase: string;   // phase union from your game
  winnerPlayerId?: string;
  metadata: Record<string, unknown>;                          // ruleset-owned extras
}
```

### `domain/actions/GameAction.ts`

One variant per verb. Base carries `type`, `gameId`, `playerId`; variants add ids/amounts:

```ts
export interface PlayCardAction extends BaseGameAction {
  readonly type: "play_card";
  readonly cardId: string; readonly laneIndex: number;
  readonly targetPlayerId?: string; readonly targetCardId?: string;
}
// ... one per verb; union them: export type GameAction = PlayCardAction | AttackAction | ...;
```

### `domain/rules/RuleSet.ts`

```ts
export interface RuleSet {
  readonly id: string; readonly version: string;
  validateDeck(deck: readonly Card[]): { ok: boolean; reason?: string };
  initializeGame(gameId: string, playerDecks: Record<string, readonly Card[]>,
                 playerNames?: Record<string, string>): GameState;
  listLegalActions(state: GameState, playerId: string): readonly GameAction[];
  applyAction(state: GameState, action: GameAction): GameState;
  getWinner(state: GameState): string | undefined;
}
```

### `domain/services/BattleEngine.ts` (game-agnostic — copy verbatim)

```ts
export class BattleEngine {
  constructor(private readonly ruleSet: RuleSet) {}

  createNewGame(gameId, playerDecks, playerNames?): GameState {
    for (const [playerId, deck] of Object.entries(playerDecks)) {
      const v = this.ruleSet.validateDeck(deck);
      if (!v.ok) throw new GameRuleViolationError(`Deck for ${playerId} invalid: ${v.reason}`);
    }
    return this.ruleSet.initializeGame(gameId, playerDecks, playerNames);
  }

  submitAction(state: GameState, action: GameAction): GameState {
    if (state.winnerPlayerId) throw new GameRuleViolationError("Game is already finished.");
    // Reject non-active players for turn-bound verbs (concede stays always-legal):
    if (ALWAYS_LEGAL_TYPES.indexOf(action.type) < 0 && action.playerId !== state.turnPlayerId) {
      throw new GameRuleViolationError("Only the active player can take this action.");
    }
    const legal = this.ruleSet.listLegalActions(state, action.playerId);
    if (!legal.some((c) => isSameActionSignature(c, action))) {
      throw new GameRuleViolationError("Action is not legal in the current game state.");
    }
    const next = this.ruleSet.applyAction(state, action);
    const winner = this.ruleSet.getWinner(next);
    return winner ? { ...next, winnerPlayerId: winner } : next;
  }
}
```

`isSameActionSignature(a, b)` switches on `a.type` and compares every discriminating field (`cardId`, `laneIndex`, `targetPlayerId`, `targetCardId`, `destination`, `amount`, ...). Write one case per action type — this is the anti-cheat seam.

### Mutation discipline (in the ruleset)

```ts
private cloneState(state: GameState): GameState {
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, {
    ...p,
    deck: p.deck.map((c) => c.clone()), hand: p.hand.map((c) => c.clone()),
    battlefield: p.battlefield.map((c) => c.clone()),
    graveyard: p.graveyard.map((c) => c.clone()), exile: p.exile.map((c) => c.clone()),
  }]));
  return { ...state, players, metadata: { ...state.metadata } };
}
// applyAction: const next = this.cloneState(state); switch (action.type) { ...mutate next...; return next; }
```

`initializeGame` gives every card a unique instance id `${playerId}-${index + 1}-${card.id}` and stores the definition id as `metadata.baseCardId`.

## Application layer

```ts
export interface GameRepository { save(s: GameState): Promise<void>; findById(id: string): Promise<GameState | undefined>; }
export interface GameEvents {
  gameStarted(s: GameState): Promise<void>;
  actionAccepted(a: GameAction, s: GameState): Promise<void>;
  gameFinished(s: GameState): Promise<void>;
}
// InMemoryGameRepository = Map wrapper. InMemoryGameEvents wraps EventEmitter, exposes .bus.

export class StartGameUseCase {
  constructor(private repo: GameRepository, private events: GameEvents, ruleSet: RuleSet) { this.engine = new BattleEngine(ruleSet); }
  async execute(gameId, playerDecks, playerNames?) {
    const state = this.engine.createNewGame(gameId, playerDecks, playerNames);
    await this.repo.save(state); await this.events.gameStarted(state);
  }
}
export class SubmitActionUseCase {
  async execute(action: GameAction) {
    const state = await this.repo.findById(action.gameId);
    if (!state) throw new GameRuleViolationError("Game not found.");
    const next = this.engine.submitAction(state, action);
    await this.repo.save(next); await this.events.actionAccepted(action, next);
    if (next.winnerPlayerId) await this.events.gameFinished(next);
  }
}
```

## Route handler pattern

```ts
export type RouteContext = { publicDir: string; playerDeckStore: AsyncPlayerDeckStore;
  gameRepository: InMemoryGameRepository; ruleSet: YourRuleSet; startGame: StartGameUseCase;
  submitAction: SubmitActionUseCase; lobbies: Map<string, LobbyState>;
  streamSubscribers: Map<string, Set<StreamSubscriber>>; broadcastLobbyState: (code: string) => void; };

export async function handleGameRoutes({ method, pathname, request, response, requestUrl, context }: RouteRequest): Promise<boolean> {
  if (method === "POST" && pathname === "/api/games") { /* ... */ return true; }
  const m = pathname.match(/^\/api\/games\/([^/]+)\/actions$/);
  if (method === "POST" && m) {
    const body = await parseJsonBody(request) as Partial<GameAction>;
    const action = { ...body, gameId: decodeURIComponent(m[1]!) } as GameAction;
    await context.submitAction.execute(action);              // throws GameRuleViolationError -> 400 upstream
    const state = await context.gameRepository.findById(action.gameId);
    writeJson(response, 200, { ok: true, winnerPlayerId: state?.winnerPlayerId });
    return true;
  }
  return false;   // chain: static -> players -> decks -> lobby -> game -> 404
}
```

Rules violations thrown as `GameRuleViolationError` become HTTP 400 with the message; the client surfaces it in its log. Unknown clients can't corrupt state — worst case they get an error.
