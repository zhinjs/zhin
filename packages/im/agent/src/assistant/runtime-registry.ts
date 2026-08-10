/**
 * Assistant Runtime 注册表（供 Host API Event Ingress 调用）。
 * Generation-scoped：provide 随 lifecycle 反注册，杜绝跨热重载悬挂。
 */
import {
  createGenerationStore,
  type Dispose,
  type GenerationStoreContext,
} from '@zhin.js/plugin-runtime';
import { type AssistantConfig, isAssistantEventsActive, resolveAssistantConfig, resolveAssistantEventsConfig } from './config.js';
import type { AssistantEventIngress } from './event-ingress.js';
import type { ScheduleJobEngine } from './job-engine.js';
import type { AssistantJobStore } from './job-store.js';
export interface AssistantRuntimeHandle {
  config: AssistantConfig & { enabled: boolean };
  store: AssistantJobStore;
  engine: ScheduleJobEngine;
  ingress: AssistantEventIngress;
}

const store = createGenerationStore<AssistantRuntimeHandle | null>('zhin.agent.assistant-runtime');

/** Registers an explicit generation value, including `null` to disable Assistant. */
export function provideAssistantRuntime(
  context: GenerationStoreContext,
  handle: AssistantRuntimeHandle | null,
): Dispose {
  return store.provide(context, handle);
}

export function getAssistantRuntime(): AssistantRuntimeHandle | null {
  return store.tryUse() ?? null;
}

export function isAssistantEventsEndpointActive(): boolean {
  const current = getAssistantRuntime();
  if (!current) return false;
  return isAssistantEventsActive(current.config);
}

export function getAssistantEventsTokenFallback(): string | undefined {
  const current = getAssistantRuntime();
  if (!current) return undefined;
  return resolveAssistantEventsConfig(current.config.events).token;
}
