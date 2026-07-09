import type { ModelRegistry, AIProvider, AgentTool } from '@zhin.js/ai';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import type { ZhinAgentConfig } from '../config/index.js';
import type { ResultSink, SubagentDefinition, SubagentSystemConfig } from './contracts.js';
import { ImResultSink } from './im-result-sink.js';
import {
  SubagentRuntime,
  type SpawnOptions,
  type SubagentCompletePayload,
  type SubagentLifecycleEvent,
  type SubagentOrigin,
  type SubagentResultDelivery,
  type SubagentResultSender,
  type SubagentRuntimeOptions,
} from './subagent-runtime.js';
export class SubagentSystem {
  private readonly resultSinks: ResultSink[] = [];
  private readonly senders: SubagentResultSender[] = [];
  private readonly definitions = new Map<string, SubagentDefinition>();
  private runtime: SubagentRuntime | null = null;

  constructor(private readonly _config: SubagentSystemConfig = {}) {}

  register(definition: SubagentDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  getDefinition(name: string): SubagentDefinition | undefined {
    return this.definitions.get(name);
  }

  attachRuntime(options: SubagentRuntimeOptions): void {
    this.runtime = new SubagentRuntime(options);
    const sender = this.composeSender();
    if (sender) this.runtime.setSender(sender);
  }

  getRuntime(): SubagentRuntime | null {
    return this.runtime;
  }

  addResultSink(sink: ResultSink): void {
    this.resultSinks.push(sink);
    if (sink instanceof ImResultSink) {
      this.senders.push(sink.asResultSender());
    }
    const sender = this.composeSender();
    if (sender && this.runtime) this.runtime.setSender(sender);
  }

  addSender(sender: SubagentResultSender): void {
    this.senders.push(sender);
    const composed = this.composeSender();
    if (composed && this.runtime) this.runtime.setSender(composed);
  }

  composeSender(): SubagentResultSender | null {
    if (this.senders.length === 0 && this.resultSinks.length === 0) return null;
    return async (origin, delivery) => {
      for (const sender of this.senders) {
        await sender(origin, delivery);
      }
      for (const sink of this.resultSinks) {
        if (sink instanceof ImResultSink) continue;
        const status = delivery.status === 'error' ? 'failed' : 'completed';
        await sink.deliver({
          taskId: delivery.taskId ?? 'unknown',
          status,
          result: delivery.text,
        });
      }
    };
  }

  setSender(sender: SubagentResultSender): void {
    this.senders.length = 0;
    this.addSender(sender);
  }

  setModelRegistry(registry: ModelRegistry | null): void {
    this.runtime?.setModelRegistry(registry);
  }

  setEventEmitter(emitter: ZhinAgentEventEmitter | null): void {
    this.runtime?.setEventEmitter(emitter);
  }

  configureRouting(deps: Parameters<SubagentRuntime['configureRouting']>[0]): void {
    this.runtime?.configureRouting(deps);
  }

  async spawn(options: SpawnOptions): Promise<string> {
    if (!this.runtime) throw new Error('SubagentSystem: runtime not attached');
    return this.runtime.spawn(options);
  }

  async spawnSync(options: SpawnOptions): Promise<string> {
    if (!this.runtime) throw new Error('SubagentSystem: runtime not attached');
    return this.runtime.spawnSync(options);
  }

  cancel(taskId: string): boolean {
    return this.runtime?.cancel(taskId) ?? false;
  }

  getRunningCount(): number {
    return this.runtime?.getRunningCount() ?? 0;
  }

  dispose(): void {
    this.runtime?.dispose();
    this.runtime = null;
    this.resultSinks.length = 0;
    this.senders.length = 0;
  }
}

export const defaultSubagentSystem = new SubagentSystem({});

export type {
  SpawnOptions,
  SubagentCompletePayload,
  SubagentLifecycleEvent,
  SubagentOrigin,
  SubagentResultDelivery,
  SubagentResultSender,
  SubagentRuntimeOptions,
};
