/**
 * Subagent System — 模块契约（与实现同步）。
 *
 * 实现：`SubagentSystem.register` / `spawn` / `spawnSync` / `cancel`；
 * `addResultSink` / `composeSender` 对接 IM outbound。
 */

import type { SpawnOptions } from './subagent-runtime.js';

export interface SubagentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model?: string;
  provider?: string;
}

export interface SubagentResult {
  taskId: string;
  status: 'completed' | 'failed';
  result: string;
  artifacts?: Artifact[];
}

export interface Artifact {
  kind: string;
  content: unknown;
}

export interface ResultSink {
  deliver(result: SubagentResult): Promise<void>;
}

export interface SubagentSystemConfig {
  /** 预留扩展面 */
}

export interface SubagentSystemSpawn {
  register(definition: SubagentDefinition): void;
  spawn(options: SpawnOptions): Promise<string>;
  spawnSync(options: SpawnOptions): Promise<string>;
  cancel(taskId: string): boolean;
}

