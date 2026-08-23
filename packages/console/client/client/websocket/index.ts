export * from "./types";
export {
  WebSocketManager,
  type ConsoleEventListener,
  type ConsoleEventRecoveryGap,
  type ConsoleEventRecoveryGapListener,
} from "./manager";
export { getWebSocketManager, destroyWebSocketManager, resetWebSocketManager } from "./instance";
export { useWebSocket, useConfig, useConfigYaml, useFiles, useEnvFiles, useDatabase } from "./hooks";
import { getWebSocketManager } from "./instance";
export default getWebSocketManager;
