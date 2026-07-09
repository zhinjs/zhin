/**
 * AgentCore 组合层依赖 — compose / defaultAgentCore 共用（阶段 5）。
 *
 * 生产 IM turn 的工具与会话链经 `agent-core-run` + `ZhinAgentPrivate` host；
 * 此处 `ToolExecutor` / `ContextManager` 为契约占位，供独立测试与 Console 路径接线。
 * `defaultAgentCore` 仅在 host 未 configure `agentCore` 时作 fallback，工具经 host 执行，不经过下方 stub。
 */
import type { AgentCoreConfig, AgentCoreDependencies } from './contracts.js';
import type { EventSystem } from '../event/event-system.js';

export const DEFAULT_AGENT_CORE_CONFIG: AgentCoreConfig = {
  maxIterations: 15,
  timeout: 120_000,
  toolExecution: 'tiered',
};

const NO_OP_EVENT_BUS: AgentCoreDependencies['eventBus'] = { emit: async () => {} };

/** 占位 provider；`defaultAgentCore` fallback 不发起 LLM 调用。 */
const NO_OP_PROVIDER = {
  name: 'no-op',
  models: [],
  chat: async () => ({ content: '' }),
  chatStream: async function* () {},
} as unknown as AgentCoreDependencies['provider'];

/** 占位工具执行器；生产路径经 `agent-core-run` + host，此处返回空结果。 */
const NO_OP_TOOL_EXECUTOR: AgentCoreDependencies['toolExecutor'] = {
  executeAll: async () => [],
};

const NO_OP_CONTEXT_MANAGER: AgentCoreDependencies['contextManager'] = {
  prepare: async (input) => ({ messages: input.messages }),
  append: async () => {},
};

function createStubAgentCoreDeps(
  overrides: Pick<AgentCoreDependencies, 'provider' | 'eventBus'>,
): AgentCoreDependencies {
  return {
    toolExecutor: NO_OP_TOOL_EXECUTOR,
    contextManager: NO_OP_CONTEXT_MANAGER,
    ...overrides,
  };
}

export function createAgentCoreDepsForCompose(
  provider: AgentCoreDependencies['provider'],
  eventSystem: EventSystem,
): AgentCoreDependencies {
  return createStubAgentCoreDeps({ provider, eventBus: eventSystem });
}

export function createDefaultAgentCoreDeps(): AgentCoreDependencies {
  return createStubAgentCoreDeps({ provider: NO_OP_PROVIDER, eventBus: NO_OP_EVENT_BUS });
}
