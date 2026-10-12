import { writeJson, readBody } from "../http-utils.js";
import type { RouteHandler } from "./context.js";
import { listCardDefinitions } from "../../../domain/card/CardDefinitions.js";
import { createCardFromDefinition } from "../../../domain/card/CardDefinitions.js";
import type { Card, ThreadColour } from "../../../domain/card/Card.js";
import { DECK_MAX_SIZE, DECK_MIN_SIZE, LOOM_SIZE, MAX_COPIES_PER_CARD, THREAD_COLOURS } from "../../../domain/rules/deckRules.js";
import { getAccountFromRequest } from "./authRoutes.js";

export const handleHealthRoutes: RouteHandler = async ({ method, pathname, response }): Promise<boolean> => {
  if (method === "GET" && pathname === "/api/health") {
    writeJson(response, 200, { ok: true, game: "manaweave" });
    return true;
  }
  return false;
};

export const handleCardRoutes: RouteHandler = async ({ method, pathname, response }): Promise<boolean> => {
  if (method === "GET" && pathname === "/api/cards/catalog") {
    const cards = listCardDefinitions();
    const categories = [...new Set(cards.map((c) => c.category))];
    writeJson(response, 200, { categories, colours: THREAD_COLOURS, cards });
    return true;
  }
  return false;
};

function parseDeckBody(body: { name?: unknown; format?: unknown; loom?: unknown; cards?: unknown }): { name: string; loom: ThreadColour[]; cards: { cardDefId: string; quantity: number }[]; format: string } | { error: string } {
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled pattern";
  const format = typeof body.format === "string" && body.format.trim() ? body.format.trim() : "standard";
  if (!Array.isArray(body.loom)) return { error: "loom must be an array of thread colours." };
  const loom = body.loom.filter((c): c is ThreadColour => typeof c === "string" && (THREAD_COLOURS as readonly string[]).includes(c));
  if (loom.length !== LOOM_SIZE) return { error: `Loom must hold exactly ${LOOM_SIZE} thread colours.` };
  if (!Array.isArray(body.cards)) return { error: "cards must be an array of {cardDefId, quantity}." };
  const cards: { cardDefId: string; quantity: number }[] = [];
  for (const entry of body.cards) {
    if (!entry || typeof entry !== "object") return { error: "Invalid card entry." };
    const { cardDefId, quantity } = entry as Record<string, unknown>;
    if (typeof cardDefId !== "string" || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_COPIES_PER_CARD) {
      return { error: "Invalid card entry (cardDefId string, quantity 1-3)." };
    }
    cards.push({ cardDefId, quantity });
  }
  return { name, loom, cards, format };
}

/** Route-level deck guard (ruleset re-validates at game start). */
async function validateDeckPayload(
  loom: ThreadColour[],
  cards: { cardDefId: string; quantity: number }[],
  ruleSet: import("../../../domain/rules/LoomRuleSet.js").LoomRuleSet,
): Promise<string | null> {
  const expanded: Card[] = [];
  for (const { cardDefId, quantity } of cards) {
    try {
      for (let i = 0; i < quantity; i++) expanded.push(createCardFromDefinition(cardDefId, cardDefId));
    } catch {
      return `Unknown card definition: ${cardDefId}`;
    }
  }
  const total = expanded.length;
  if (total < DECK_MIN_SIZE) return `Deck must have at least ${DECK_MIN_SIZE} cards (has ${total}).`;
  if (total > DECK_MAX_SIZE) return `Deck must have at most ${DECK_MAX_SIZE} cards (has ${total}).`;
  const dv = ruleSet.validateDeck(expanded);
  if (!dv.ok) return dv.reason ?? "Deck invalid.";
  const lv = ruleSet.validateLoom(loom, expanded);
  if (!lv.ok) return lv.reason ?? "Loom invalid.";
  return null;
}

/** Deck CRUD, scoped to the logged-in account (Bearer token). */
export const handleDeckRoutes: RouteHandler = async ({ method, pathname, request, response, context }): Promise<boolean> => {
  if (!pathname.startsWith("/api/decks")) return false;
  const account = await getAccountFromRequest(request, context);
  if (!account) {
    writeJson(response, 401, { error: "Log in to manage decks." });
    return true;
  }
  const deckStore = context.deckStore;
  let m: RegExpMatchArray | null;

  if (pathname === "/api/decks") {
    if (method === "GET") {
      const decks = await deckStore.listDecksByPlayer(account.id);
      writeJson(response, 200, { decks });
      return true;
    }
    if (method === "POST") {
      const body = await readBody<Record<string, unknown>>(request);
      const parsed = parseDeckBody(body);
      if ("error" in parsed) {
        writeJson(response, 400, { error: parsed.error });
        return true;
      }
      const invalid = await validateDeckPayload(parsed.loom, parsed.cards, context.ruleSet);
      if (invalid) {
        writeJson(response, 400, { error: invalid });
        return true;
      }
      const deck = await deckStore.saveDeck({ playerId: account.id, name: parsed.name, format: parsed.format, loom: parsed.loom, cards: parsed.cards });
      writeJson(response, 200, { deck });
      return true;
    }
  }

  m = pathname.match(/^\/api\/decks\/([^/]+)$/);
  if (m) {
    const deckId = decodeURIComponent(m[1]!);
    const deck = await deckStore.getDeckByIdForPlayer(account.id, deckId);
    if (!deck) {
      writeJson(response, 404, { error: "Deck not found." });
      return true;
    }
    if (method === "GET") {
      writeJson(response, 200, { deck });
      return true;
    }
    if (method === "PUT") {
      const body = await readBody<Record<string, unknown>>(request);
      const parsed = parseDeckBody(body);
      if ("error" in parsed) {
        writeJson(response, 400, { error: parsed.error });
        return true;
      }
      const invalid = await validateDeckPayload(parsed.loom, parsed.cards, context.ruleSet);
      if (invalid) {
        writeJson(response, 400, { error: invalid });
        return true;
      }
      const saved = await deckStore.saveDeck({ playerId: account.id, deckId, name: parsed.name, format: parsed.format, loom: parsed.loom, cards: parsed.cards });
      writeJson(response, 200, { deck: saved });
      return true;
    }
    if (method === "DELETE") {
      const ok = await deckStore.deleteDeck(account.id, deckId);
      writeJson(response, ok ? 200 : 404, ok ? { ok: true } : { error: "Deck not found." });
      return true;
    }
  }
  return false;
};
