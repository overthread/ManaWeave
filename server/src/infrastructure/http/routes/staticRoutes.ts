import { promises as fs } from "node:fs";
import path from "node:path";
import type { RouteHandler, RouteRequest } from "./context.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export const handleStaticRoutes: RouteHandler = async ({ method, pathname, requestUrl, response, context }: RouteRequest): Promise<boolean> => {
  if (method !== "GET" && method !== "HEAD") return false;

  if (pathname === "/") {
    const gameId = requestUrl.searchParams.get("gameId");
    if (!gameId) {
      response.writeHead(302, { Location: "/lobby.html" });
      response.end();
      return true;
    }
    pathname = "/index.html";
  }

  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(context.publicDir, safe);
  if (!filePath.startsWith(context.publicDir)) return false;

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-cache",
    });
    response.end(method === "HEAD" ? undefined : data);
    return true;
  } catch {
    return false;
  }
};
