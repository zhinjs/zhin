/**
 * AI 模块初始化
 *
 * 将 AI 服务注册到 Zhin 插件系统中。
 * 每个子职责拆分到 init/ 下的独立模块：
 *   - register-tool-service   — ToolFeature 注册
 *   - register-db-models      — 数据库模型定义
 *   - register-ai-service     — AIService context
 *   - create-zhin-agent       — ZhinAgent 全局大脑 + 子系统
 *   - register-ai-trigger     — AI 触发处理器
 *   - register-db-upgrade     — 数据库存储升级（无竞态条件）
 *   - register-owner-approve-commands — Owner 私聊 approve（仅 bash shell 硬确认白名单）
 *   - register-builtin-tools  — 内置系统工具 + 工作区技能
 */

import './init/types.js';
import { createRefs } from './init/shared-refs.js';
import { registerOrchestrator } from './init/register-orchestrator.js';
import { registerMcpFromConfig } from './init/register-mcp-from-config.js';
import { registerToolService } from './init/register-tool-service.js';
import { registerDbModels } from './init/register-db-models.js';
import { registerAIService } from './init/register-ai-service.js';
import { createZhinAgentContext } from './init/create-zhin-agent.js';
import { registerAITrigger } from './init/register-ai-trigger.js';
import { registerGroupSessionPassive } from './init/register-group-session-passive.js';
import { registerDbUpgrade } from './init/register-db-upgrade.js';
import { registerManagementTools } from './init/register-management-tools.js';
import { registerOwnerApproveCommands } from './init/register-owner-approve-commands.js';
import { registerIntrospectionCommands } from './init/register-introspection-commands.js';
import { registerCollaborationCommands } from './init/register-collaboration-commands.js';
import { registerInitWizardGuardrail } from './init/register-init-wizard-guardrail.js';
import { registerBuiltinTools } from './init/register-builtin-tools.js';
import { registerHomeTools } from './init/register-home-tools.js';
import { registerImSegmentFilter } from './init/register-im-segment-filter.js';

/**
 * 初始化 AI 模块
 *
 * 在 setup.ts 中调用：
 * ```ts
 * import { initAgentModule } from '@zhin.js/agent';
 * initAgentModule();
 * ```
 */
export function initAgentModule(): void {
  const refs = createRefs();

  registerOrchestrator();
  registerMcpFromConfig();
  registerToolService();
  registerDbModels();
  registerAIService(refs);
  createZhinAgentContext(refs);
  registerAITrigger(refs);
  registerGroupSessionPassive(refs);
  registerDbUpgrade(refs);
  registerManagementTools(refs);
  registerOwnerApproveCommands();
  registerCollaborationCommands();
  registerInitWizardGuardrail();
  registerIntrospectionCommands(refs);
  registerBuiltinTools(refs);
  registerHomeTools();
  registerImSegmentFilter();
}
