/**
 * AgentRuntimeReset — 集中重置所有 agent 级全局单例。
 *
 * 用于测试隔离：在 afterEach 中调用 resetAllAgentSingletons()。
 * 生产环境不需要调用——单例生命周期由 createZhinAgentContext 管理。
 *
 * @lifecycle 每个单例都遵循同一生命周期：
 *   init (bootstrap) -> read-only (runtime) -> reset (shutdown/test)
 */

import { resetSandbox } from './security/sandbox.js';
import { resetAgentDispatcher } from './orchestrator/agent-dispatcher.js';
import { resetOrchestrationRuntime } from './orchestration-runtime-registry.js';
import { resetSessionTreeRuntime } from './session-tree-runtime-registry.js';
import { resetAssistantRuntime } from './assistant/runtime-registry.js';
import { resetRemoteAgentRegistry } from './orchestrator/remote-agent-registry.js';
import { resetDelegationProcessor } from './orchestrator/delegation-processor.js';
import { resetTypingIndicatorManager } from './typing-indicator/index.js';
import { resetCronManager } from './cron-engine.js';

/** 重置所有 agent 级全局单例（用于测试隔离） */
export function resetAllAgentSingletons(): void {
  resetSandbox();
  resetAgentDispatcher();
  resetOrchestrationRuntime();
  resetSessionTreeRuntime();
  resetAssistantRuntime();
  resetRemoteAgentRegistry();
  resetDelegationProcessor();
  resetTypingIndicatorManager();
  resetCronManager();
}
