/**
 * Stateless bearer tokens: `<accountId>.<hmac>`. No server-side session
 * storage — tokens survive restarts as long as the secret is stable. The
 * secret comes from AUTH_SECRET, from DATA_DIR/auth-secret (JSON mode), or
 * from Postgres when DATABASE_URL is set (see persistence/PostgresStores.ts).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

async function loadSecret(dataDir: string): Promise<string> {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = path.join(dataDir, "auth-secret");
  try {
    const existing = (await fs.readFile(file, "utf8")).trim();
    if (existing) return existing;
  } catch {
    /* first boot */
  }
  const secret = crypto.randomBytes(32).toString("hex");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(file, secret, "utf8");
  return secret;
}

export interface TokenService {
  issue(accountId: string): string;
  verify(token: string): string | null;
}

export function createTokenServiceFromSecret(secret: string): TokenService {
  const sign = (accountId: string) => crypto.createHmac("sha256", secret).update(accountId).digest("hex");
  return {
    issue: (accountId) => `${accountId}.${sign(accountId)}`,
    verify: (token) => {
      if (typeof token !== "string") return null;
      const dot = token.lastIndexOf(".");
      if (dot <= 0) return null;
      const accountId = token.slice(0, dot);
      const mac = token.slice(dot + 1);
      const expected = sign(accountId);
      return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? accountId : null;
    },
  };
}

export async function createTokenService(dataDir: string): Promise<TokenService> {
  return createTokenServiceFromSecret(await loadSecret(dataDir));
}
