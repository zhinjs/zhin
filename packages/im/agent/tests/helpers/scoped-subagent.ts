import type { LlmCompletionPort, Model } from '@zhin.js/ai';
type TestCompletion = LlmCompletionPort & { model(alias: string, id: string): Model };
import { SubagentRuntime, type SubagentRuntimeOptions } from '../../src/subagent/subagent-runtime.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { executionBundle, executionScope } from './execution-bundle.js';

/** Consumer fixture only. The real retained-generation integration has separate tests. */
export function createTestSubagentRuntime(input: Readonly<{
  runtime: TestCompletion; alias: string; model: string; options: SubagentRuntimeOptions;
}>): SubagentRuntime {
  const manager = new SubagentRuntime(input.options);
  const methods = { spawn: manager.spawn.bind(manager), spawnSync: manager.spawnSync.bind(manager) };
  for (const method of ['spawn', 'spawnSync'] as const) manager[method] = async options => {
    const chat = executionBundle({ model: input.runtime.model(input.alias, input.model), completion: input.runtime });
    const models = await executionScope({ chat, summary: chat });
    try { return await runWithAgentTurnConfiguration({ models }, () => methods[method](options)); }
    finally { await models.release(); }
  };
  return manager;
}
