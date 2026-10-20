/** Host API + plugin entry routes (entries, esm, @assets). Remote UI uses root paths (/dashboard, …). */
export const DEFAULT_CONSOLE_BASE_PATH = "/";

export const CONSOLE_HOST_REACT_NAMESPACE_KEY = "__ZHIN_CONSOLE_HOST_REACT_NAMESPACE__";

export const CONSOLE_SHARED_MODULES_KEY = "__ZHIN_CONSOLE_SHARED_MODULES__";

/** Compatibility re-exports; @zhin.js/console-protocol is the wire SSOT. */
export {
  SIDE_EVENT_PUSH,
  SIDE_EVENT_RPC,
  INBOX_RPC,
  ENDPOINT_RPC,
  SIDE_EVENT_NAMES,
} from '@zhin.js/console-protocol';
