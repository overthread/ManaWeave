import crypto from "node:crypto";

export interface LobbyChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  sentAt: number;
}

export interface LobbyDeckSelection {
  playerProfileId: string;
  deckId: string;
  deckName: string;
  loom: string[];
  selectedAt: number;
}

export interface LobbyState {
  roomCode: string;
  status: "waiting" | "started";
  players: { id: "p1" | "p2"; name: string }[];
  /** Seat -> owning account id (seat identity for refresh recovery). */
  playerAccounts: Partial<Record<"p1" | "p2", string>>;
  playerSessionKeys: Record<string, string>;
  deckSelections: Partial<Record<"p1" | "p2", LobbyDeckSelection>>;
  messages: LobbyChatMessage[];
  gameId?: string;
  createdAt: number;
}

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

export function generatePlayerKey(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function createLobby(hostAccountId: string, hostName: string): LobbyState {
  return {
    roomCode: generateRoomCode(),
    status: "waiting",
    players: [{ id: "p1", name: hostName || "Host" }],
    playerAccounts: { p1: hostAccountId },
    playerSessionKeys: { p1: generatePlayerKey() },
    deckSelections: {},
    messages: [],
    createdAt: Date.now(),
  };
}

/** Client-safe lobby view: never expose session keys. */
export function lobbyView(lobby: LobbyState): Record<string, unknown> {
  return {
    roomCode: lobby.roomCode,
    status: lobby.status,
    players: lobby.players,
    deckSelections: lobby.deckSelections,
    messages: lobby.messages.slice(-50),
    gameId: lobby.gameId ?? null,
    hostId: "p1",
  };
}

export function pushLobbyMessage(lobby: LobbyState, senderId: string, senderName: string, text: string): void {
  const clean = text.trim().slice(0, 240);
  if (!clean) return;
  lobby.messages.push({ id: crypto.randomUUID(), senderId, senderName, text: clean, sentAt: Date.now() });
  if (lobby.messages.length > 100) lobby.messages.splice(0, lobby.messages.length - 100);
}
