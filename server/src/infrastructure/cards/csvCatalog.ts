/**
 * Optional CSV catalog ingestion (e.g. published Google Sheets).
 * One env var per category: CARD_CSV_UNITS_URL, CARD_CSV_SPELLS_URL.
 * Each var accepts multiple URLs separated by commas or whitespace, so a
 * single var can point at several published tabs (e.g. one per colour);
 * each row's `type` column decides unit vs spell regardless of category.
 * Sheets /pubhtml URLs are normalized to CSV output. Failures fall back to the
 * built-in catalog with a warning — the game always starts playable.
 */

import type { CardDefinition } from "../../domain/card/CardDefinitions.js";
import type { CardEffect, CostColour, CostEntry, OrientationName, ThreadColour } from "../../domain/card/Card.js";

const VALID_COLOURS: readonly ThreadColour[] = ["ember", "tide", "verdant", "umbra", "neutral"];
const VALID_ORIENTATIONS: readonly OrientationName[] = ["up", "right", "down", "left"];

/**
 * Parse an orientation cost cell. Entries are separated by "+", "," or
 * whitespace and each is "colour:orientation" ("ember:up", "e:r", "any:down").
 * A bare orientation token ("up") and a bare number N (legacy sheets) use the
 * card's own colour — or "any" when the card is neutral (N becomes N x up).
 */
function parseCostCell(raw: string, cardColour: ThreadColour): CostEntry[] {
  const text = raw.trim().toLowerCase();
  if (!text) return [];
  const fallbackColour: CostColour = cardColour === "neutral" ? "any" : cardColour;
  if (/^\d+$/.test(text)) {
    const n = Math.max(0, Math.min(4, Number.parseInt(text, 10)));
    return Array.from({ length: n }, () => ({ colour: fallbackColour, orientation: "up" as OrientationName }));
  }
  const out: CostEntry[] = [];
  for (const token of text.split(/[^a-z:]+/).filter(Boolean)) {
    const parts = token.split(":");
    const colourRaw = parts.length >= 2 ? parts[0]! : undefined;
    const orientationRaw = parts.length >= 2 ? parts[1]! : parts[0]!;
    const orientation = VALID_ORIENTATIONS.find((o) => o.startsWith(orientationRaw));
    if (!orientation) continue;
    const colour = colourRaw === undefined
      ? fallbackColour
      : ((["any", "neutral", "ember", "tide", "verdant", "umbra"] as const).find((c) => c.startsWith(colourRaw)) ?? fallbackColour);
    out.push({ colour: colour === "neutral" ? "any" : colour, orientation });
  }
  return out.slice(0, 4);
}

/** Minimal quoted-CSV parser (handles "" escapes and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "card";
}

function parseEffectsJson(value: string | undefined): CardEffect[] {
  if (!value || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is CardEffect => !!e && typeof e === "object" && typeof (e as CardEffect).kind === "string");
  } catch {
    return [];
  }
}

export function csvRowsToDefinitions(category: string, rows: string[][]): CardDefinition[] {
  if (rows.length < 2) return [];
  const headers = rows[0]!.map(normalizeHeader);
  const col = (row: string[], ...names: string[]): string => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0 && i < row.length) return (row[i] ?? "").trim();
    }
    return "";
  };
  const defs: CardDefinition[] = [];
  for (const row of rows.slice(1)) {
    const title = col(row, "title", "name");
    if (!title) continue;
    const id = col(row, "card_id", "id") || slugify(title);
    const type = col(row, "type").toLowerCase() === "spell" ? "spell" : "unit";
    const colour = col(row, "colour", "color");
    const effectsRaw = col(row, "effects");
    const onPlayRaw = col(row, "on_play");
    const cardColour: ThreadColour = (VALID_COLOURS as readonly string[]).includes(colour) ? (colour as ThreadColour) : "neutral";
    const cost = parseCostCell(col(row, "cost"), cardColour);
    // Legacy orientation_req column: force the last entry's orientation.
    const orientationRaw = col(row, "orientation_req", "orientation");
    if ((VALID_ORIENTATIONS as readonly string[]).includes(orientationRaw) && cost.length > 0) {
      cost[cost.length - 1] = { ...cost[cost.length - 1]!, orientation: orientationRaw as OrientationName };
    }
    const def: CardDefinition = {
      id,
      title,
      type,
      colour: cardColour,
      cost,
      attack: Math.max(0, Number.parseInt(col(row, "attack", "power"), 10) || 0),
      health: Math.max(0, Number.parseInt(col(row, "health"), 10) || 0),
      haste: /^(true|yes|1)$/i.test(col(row, "haste", "quickstride")),
      effects: parseEffectsJson(effectsRaw),
      onPlay: parseEffectsJson(onPlayRaw),
      text: col(row, "text", "description"),
      rarity: col(row, "rarity") || "common",
      category,
    };
    defs.push(def);
  }
  return defs;
}

async function fetchCsv(url: string): Promise<string> {
  const normalized = url.includes("/pubhtml") ? url.replace("/pubhtml", "/pub") : url;
  const withOutput = new URL(normalized);
  if (!withOutput.searchParams.has("output")) withOutput.searchParams.set("output", "csv");
  withOutput.searchParams.set("single", "true");
  const res = await fetch(withOutput, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function loadCardCatalogFromConfiguredCsvs(): Promise<{ cards: CardDefinition[]; warnings: string[] }> {
  const warnings: string[] = [];
  const cards: CardDefinition[] = [];
  const seenIds = new Set<string>();
  const categories: Array<[string, string | undefined]> = [
    ["units", process.env.CARD_CSV_UNITS_URL],
    ["spells", process.env.CARD_CSV_SPELLS_URL],
  ];
  for (const [category, urlList] of categories) {
    if (!urlList) continue;
    for (const url of urlList.split(/[,\s]+/).filter(Boolean)) {
      try {
        const csv = await fetchCsv(url);
        const defs = csvRowsToDefinitions(category, parseCsv(csv));
        if (defs.length === 0) throw new Error("no parseable rows");
        for (const def of defs) {
          if (seenIds.has(def.id)) continue;
          seenIds.add(def.id);
          cards.push(def);
        }
      } catch (err) {
        warnings.push(`CSV category '${category}' failed to load ${url} (${err instanceof Error ? err.message : err}); using fallback.`);
      }
    }
  }
  return { cards, warnings };
}
