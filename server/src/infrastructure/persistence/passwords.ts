import crypto from "node:crypto";

/**
 * Playtest-grade password hashing (unsalted sha256, namespaced by username).
 * Shared by every AccountStore adapter so hashes stay interchangeable
 * between the JSON file store and Postgres.
 */
export function hashPassword(username: string, password: string): string {
  return crypto.createHash("sha256").update(`${username.toLowerCase()}:${password}`).digest("hex");
}
