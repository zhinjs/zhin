/**
 * Assistant Runtime 全局注册表（供 Host API Event Ingress 调用）
 */
import type { AssistantConfig } from './config.js';
import { isAssistantEventsActive, resolveAssistantConfig, resolveAssistantEventsConfig } from './config.js';
import type { AssistantEventIngress } from './event-ingress.js';
import type { AssistantJobEngine } from './job-engine.js';
import type { AssistantJobStore } from './job-store.js';

export interface AssistantRuntimeHandle {
  config: AssistantConfig & { enabled: boolean };
  store: AssistantJobStore;
  engine: AssistantJobEngine;
  ingress: AssistantEventIngress;
}

let runtime: AssistantRuntimeHandle | null = null;

export function resetAssistantRuntime(): void { runtime = null; }

export function setAssistantRuntime(handle: AssistantRuntimeHandle | null): void {
  runtime = handle;
}

export function getAssistantRuntime(): AssistantRuntimeHandle | null {
  return runtime;
}

export function isAssistantEventsEndpointActive(): boolean {
  if (!runtime) return false;
  return isAssistantEventsActive(runtime.config);
}

export function getAssistantEventsTokenFallback(): string | undefined {
  if (!runtime) return undefined;
  return resolveAssistantEventsConfig(runtime.config.events).token;
}
