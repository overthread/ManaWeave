import { writeJson, readBody } from "../http-utils.js";
import type { RouteHandler } from "./context.js";
import type { StoredAccount } from "../../../application/ports.js";
import { hashPassword } from "../../persistence/JsonAccountStore.js";

/** Resolve the bearer token on a request to an account, or null. */
export async function getAccountFromRequest(request: import("node:http").IncomingMessage, context: import("./context.js").RouteContext): Promise<StoredAccount | null> {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const accountId = context.tokens.verify(header.slice("Bearer ".length).trim());
  if (!accountId) return null;
  return (await context.accountStore.findById(accountId)) ?? null;
}

function accountView(account: StoredAccount) {
  return { id: account.id, username: account.username, displayName: account.displayName };
}

export const handleAuthRoutes: RouteHandler = async ({ method, pathname, request, response, context }): Promise<boolean> => {
  if (!pathname.startsWith("/api/auth/")) return false;

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readBody<{ username?: unknown; password?: unknown; displayName?: unknown }>(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName : undefined;
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(username)) {
      writeJson(response, 400, { error: "Username must be 2-40 characters (letters, digits, _ or -)." });
      return true;
    }
    if (password.length < 1) {
      writeJson(response, 400, { error: "Password is required." });
      return true;
    }
    try {
      const account = await context.accountStore.register({ username, password, displayName });
      writeJson(response, 200, { account: accountView(account), token: context.tokens.issue(account.id) });
    } catch (err) {
      writeJson(response, 409, { error: err instanceof Error ? err.message : "Registration failed." });
      return true;
    }
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody<{ username?: unknown; password?: unknown }>(request);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const account = await context.accountStore.findByUsername(username);
    if (!account || account.passwordHash !== hashPassword(account.username, password)) {
      writeJson(response, 401, { error: "Wrong username or password." });
      return true;
    }
    writeJson(response, 200, { account: accountView(account), token: context.tokens.issue(account.id) });
    return true;
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    // Stateless tokens: the client just drops the token. Endpoint kept so the
    // client API stays symmetric.
    writeJson(response, 200, { ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/api/auth/me") {
    const account = await getAccountFromRequest(request, context);
    if (!account) {
      writeJson(response, 401, { error: "Not logged in." });
      return true;
    }
    writeJson(response, 200, { account: accountView(account) });
    return true;
  }

  return false;
};
