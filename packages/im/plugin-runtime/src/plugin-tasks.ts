import { createToken } from './token.js';
import type { DeliveryTarget } from './delivery-target.js';
import type { JsonValue } from './persistent-state.js';
import type { GenerationAdmissionSource } from './admission.js';
import type { Locale } from './i18n.js';

export type PluginTaskState = 'scheduled' | 'paused' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'cancelled';
export type PluginTaskAction = 'pause' | 'resume' | 'cancel' | 'update';

/** Business task facts. Chat-user tasks are deliberately outside this administrator port. */
export interface PluginTask {
  readonly id: string;
  readonly ownership: 'administrator';
  readonly title: string;
  readonly target: DeliveryTarget;
  readonly state: PluginTaskState;
  readonly createdAt: number;
  readonly nextRunAt?: number;
  readonly lastRunAt?: number;
  readonly timezone?: string;
  readonly detail?: string;
  readonly parameters: Readonly<Record<string, JsonValue>>;
  readonly actions: readonly PluginTaskAction[];
}

export interface PluginTaskSnapshot {
  /** Changes whenever facts change. A stale mutation must fail instead of overwriting. */
  readonly revision: string;
  readonly tasks: readonly PluginTask[];
  /** Bounded durable mutation acknowledgements, distinct from external delivery receipts. */
  readonly receipts: readonly PluginTaskMutationReceipt[];
}

export interface PluginTaskMutationReceipt {
  readonly requestId: string;
  readonly taskId: string;
  readonly operation: 'create' | PluginTaskAction;
}

export interface PluginTaskMutation {
  /** Display language only; excluded from mutation identity and notification settings. */
  readonly locale?: Locale;
  /** Client-created operation UUID, retained for reconciliation after a lost response. */
  readonly requestId: string;
  readonly expectedRevision: string;
}

/** Optional plugin-owned task service, resolved from the current generation's owner scope. */
export interface PluginTaskProvider extends GenerationAdmissionSource {
  readonly i18n?: Readonly<Partial<Record<Locale, Readonly<{
    title?: string; description?: string; effects?: readonly string[];
  }>>>>;
  readonly title: string;
  readonly description: string;
  /** JSON Schema for this provider's creation/update parameters, never a Console-specific form. */
  readonly schema: Readonly<Record<string, JsonValue>>;
  /** Discloses future external effects before the operator creates a task. */
  readonly effects: readonly string[];
  read(options?: Readonly<{ locale?: Locale }>): Promise<PluginTaskSnapshot>;
  create(input: PluginTaskMutation & Readonly<{
    target: DeliveryTarget;
    parameters: Readonly<Record<string, JsonValue>>;
  }>): Promise<PluginTaskSnapshot>;
  change(input: PluginTaskMutation & Readonly<{
    id: string;
    action: PluginTaskAction;
    parameters?: Readonly<Record<string, JsonValue>>;
  }>): Promise<PluginTaskSnapshot>;
}

/** message is safe business guidance for administrators; never include secrets or raw exceptions. */
export class PluginTaskError extends Error {
  readonly code: 'invalid_input' | 'conflict' | 'not_found' | 'unsupported' | 'unavailable';
  constructor(code: PluginTaskError['code'], message: string) {
    super(message);
    this.name = 'PluginTaskError';
    this.code = code;
  }
}

export const pluginTaskProviderToken = createToken<PluginTaskProvider>(
  'zhin.plugin-task-provider',
  'Plugin-owned persistent administrator tasks, controlled only through authenticated Host operations',
);
