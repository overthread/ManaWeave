/**
 * JSON-file account persistence behind the AccountStore port.
 * Accounts live in DATA_DIR/accounts.json; passwords are stored as unsalted
 * sha256 (playtest-grade, per project constraints — not production auth).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AccountStore, StoredAccount } from "../../application/ports.js";
import { hashPassword } from "./passwords.js";

interface StoreFile {
  accounts: StoredAccount[];
}

export class JsonAccountStore implements AccountStore {
  private readonly file: string;
  private cache: StoreFile | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "accounts.json");
  }

  private async load(): Promise<StoreFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      this.cache = { accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [] };
    } catch {
      this.cache = { accounts: [] };
    }
    return this.cache;
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.cache ?? { accounts: [] }, null, 2);
    this.writing = this.writing.then(() => fs.writeFile(this.file, snapshot, "utf8")).catch(() => undefined);
    return this.writing;
  }

  async register(input: { username: string; password: string; displayName?: string }): Promise<StoredAccount> {
    const store = await this.load();
    const username = input.username.trim().slice(0, 40);
    const existing = store.accounts.find((a) => a.username.toLowerCase() === username.toLowerCase());
    if (existing) throw new Error("That username is already taken.");
    const account: StoredAccount = {
      id: crypto.randomUUID(),
      username,
      displayName: (input.displayName?.trim() || username).slice(0, 40),
      passwordHash: hashPassword(username, input.password),
      createdAt: Date.now(),
    };
    store.accounts.push(account);
    await this.persist();
    return account;
  }

  async findByUsername(username: string): Promise<StoredAccount | undefined> {
    const store = await this.load();
    const needle = username.trim().toLowerCase();
    return store.accounts.find((a) => a.username.toLowerCase() === needle);
  }

  async findById(id: string): Promise<StoredAccount | undefined> {
    const store = await this.load();
    return store.accounts.find((a) => a.id === id);
  }

  async close(): Promise<void> {
    await this.writing;
  }
}
