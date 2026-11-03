import type { LlmCompletionPort, Model } from '@zhin.js/ai';
type TestCompletion = LlmCompletionPort & { model(alias: string, id: string): Model };
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import type { ZhinAgentConfig } from '../../src/config/index.js';
import type { AgentEventBus } from '../../src/event/ai-event-bus.js';
import { executionBundle, executionScope } from './execution-bundle.js';

const fixtures = new WeakMap<ZhinAgent, Readonly<{ runtime: TestCompletion; alias: string; model: string }>>();
export async function testAgentModels(agent: ZhinAgent) {
  const input = fixtures.get(agent);
  if (!input) throw new Error('Missing Agent execution fixture');
  const chat = executionBundle({ model: input.runtime.model(input.alias, input.model), completion: input.runtime });
  return executionScope({ chat, summary: chat });
}

/** Consumer test fixture: every public turn receives a real, explicit operation scope.
 * The runtime is the test's installed SDK bridge; no production Provider fallback is installed. */
export function createTestZhinAgent(input: Readonly<{
  runtime: TestCompletion;
  alias: string;
  model: string;
  config?: ZhinAgentConfig;
  events?: AgentEventBus;
}>): ZhinAgent {
  const agent = new ZhinAgent({ config: input.config, events: input.events });
  fixtures.set(agent, input);
  const original = agent.processTurn.bind(agent);
  agent.processTurn = async request => {
    if (request.configuration?.models) return original(request);
    const models = await testAgentModels(agent);
    try { return await original({ ...request, configuration: { ...request.configuration, models } }); }
    finally { await models.release(); }
  };
  return agent;
}
