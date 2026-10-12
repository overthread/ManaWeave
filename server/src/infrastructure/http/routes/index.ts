import type { RouteHandler } from "./context.js";
import { handleStaticRoutes } from "./staticRoutes.js";
import { handleCardRoutes, handleDeckRoutes, handleHealthRoutes, handlePlayerRoutes } from "./apiRoutes.js";
import { handleLobbyRoutes } from "./lobbyRoutes.js";
import { handleGameRoutes } from "./gameRoutes.js";

const HANDLERS: readonly RouteHandler[] = [
  handleStaticRoutes,
  handleHealthRoutes,
  handleCardRoutes,
  handlePlayerRoutes,
  handleDeckRoutes,
  handleLobbyRoutes,
  handleGameRoutes,
];

export { HANDLERS };
