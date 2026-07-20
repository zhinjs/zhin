/**
 * Assistant Runtime 全局注册表（供 Host API Event Ingress 调用）
 */
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

let runtime: AssistantRuntimeHandle | null = null;
const registrations: Array<{ readonly value: AssistantRuntimeHandle | null }> = [];

export function setAssistantRuntime(handle: AssistantRuntimeHandle | null): void {
  runtime = handle;
}

/** Registers an explicit generation value, including `null` to disable Assistant. */
export function registerAssistantRuntime(handle: AssistantRuntimeHandle | null): () => void {
  const registration = Object.freeze({ value: handle });
  registrations.push(registration);
  return () => {
    const index = registrations.lastIndexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

export function getAssistantRuntime(): AssistantRuntimeHandle | null {
  const current = registrations[registrations.length - 1];
  return current ? current.value : runtime;
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
