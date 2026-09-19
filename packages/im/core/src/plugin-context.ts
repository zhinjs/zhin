/**
 * Classic Plugin execution context.
 *
 * This module only owns the AsyncLocalStorage used while the classic Plugin
 * runtime is being removed. Removed lookup APIs are deliberately not exported.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Plugin } from "./plugin.js";

// ============================================================================
// AsyncLocalStorage 上下文
// ============================================================================

export const storage = new AsyncLocalStorage<Plugin>();
