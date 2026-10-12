import type { RouteHandler } from "./context.js";
import { handleStaticRoutes } from "./staticRoutes.js";
import { handleCardRoutes, handleDeckRoutes, handleHealthRoutes } from "./apiRoutes.js";
import { handleAuthRoutes } from "./authRoutes.js";
import { handleLobbyRoutes } from "./lobbyRoutes.js";
import { handleGameRoutes } from "./gameRoutes.js";

const HANDLERS: readonly RouteHandler[] = [
  handleStaticRoutes,
  handleHealthRoutes,
  handleCardRoutes,
  handleAuthRoutes,
  handleDeckRoutes,
  handleLobbyRoutes,
  handleGameRoutes,
];

export { HANDLERS };
