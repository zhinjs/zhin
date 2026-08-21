/** Agent 角色定义与预定义配置（数据表；从 agent-dispatcher.ts 拆出，零依赖模块）。 */


export type AgentRole =
  | 'subtask'        // 子任务 Agent（后台执行）
  | 'worker'         // 工作 Agent（延迟任务）
  | 'researcher'     // 研究 Agent（只读检索）
  | 'evaluator'      // 评估 Agent（纯推理，零外部工具，ADR 0024）
  | 'executor'       // 执行 Agent（写操作）
  | 'reviewer'       // 审查 Agent（质检；仅读 artifact）
  | 'planner';       // 规划 Agent（总控/路由，ADR 0024 director）

export interface AgentRoleConfig {
  /** 角色名称 */
  role: AgentRole;
  /** 角色描述 */
  description: string;
  /** 允许的工具集 */
  allowedTools: string[];
  /** 禁止的工具集 */
  blockedTools: string[];
  /** 是否允许发送消息给用户 */
  canSendMessage: boolean;
  /** 是否允许 spawn 子 Agent */
  canSpawnSubagents: boolean;
  /** 是否允许访问主 Agent 历史 */
  canAccessMainHistory: boolean;
  /** 是否允许执行写操作 */
  canWrite: boolean;
  /** 是否允许执行危险操作 */
  canExecuteDangerous: boolean;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 最大工具调用次数 */
  maxToolCalls: number;
  /** 超时时间（毫秒） */
  timeout: number;
}

export const AGENT_ROLE_CONFIGS: Record<AgentRole, AgentRoleConfig> = {
  subtask: {
    role: 'subtask',
    description: '子任务 Agent，后台执行特定任务',
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_dir', 'glob', 'grep',
      'bash', 'web_search', 'web_fetch',
      'generate_image', 'analyze_media',
    ],
    blockedTools: ['send_message', 'spawn_subagent', 'discover'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: true,
    canExecuteDangerous: false,
    maxIterations: 15,
    maxToolCalls: 50,
    timeout: 300000,  // 5 分钟
  },

  worker: {
    role: 'worker',
    description: '工作 Agent，执行延迟任务',
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_dir', 'glob', 'grep',
      'bash', 'web_search', 'web_fetch',
      'generate_image', 'analyze_media',
    ],
    blockedTools: ['send_message', 'spawn_subagent'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: true,
    canExecuteDangerous: false,
    maxIterations: 10,
    maxToolCalls: 30,
    timeout: 180000,  // 3 分钟
  },

  researcher: {
    role: 'researcher',
    description: '研究 Agent，只读检索 + 事实交叉验证（ADR 0024）',
    allowedTools: [
      'read_file', 'list_dir', 'glob', 'grep',
      'web_search', 'web_fetch',
    ],
    blockedTools: ['write_file', 'edit_file', 'bash', 'send_message', 'spawn_subagent'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 10,
    maxToolCalls: 30,
    timeout: 180000,
  },

  evaluator: {
    role: 'evaluator',
    description: '评估 Agent，纯逻辑推理与方案评估；只读文件 + artifact（ADR 0024）',
    allowedTools: [
      'read_file', 'list_dir', 'glob', 'grep',
    ],
    blockedTools: [
      'write_file', 'edit_file',
      'bash', 'web_search', 'web_fetch', 'send_message', 'spawn_subagent',
      'generate_image', 'analyze_media',
    ],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 8,
    maxToolCalls: 16,
    timeout: 180000,
  },

  executor: {
    role: 'executor',
    description: '执行 Agent，物理落地与工具调用（写/bash/MCP/生图）（ADR 0024）',
    allowedTools: [
      'read_file', 'write_file', 'edit_file',
      'list_dir', 'glob', 'grep',
      'bash',
      'generate_image', 'analyze_media',
    ],
    blockedTools: ['send_message', 'spawn_subagent'],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: true,
    canExecuteDangerous: false,
    maxIterations: 10,
    maxToolCalls: 30,
    timeout: 180000,
  },

  reviewer: {
    role: 'reviewer',
    description: '审查 Agent，质检合规；只读文件（禁搜网，ADR 0024）',
    allowedTools: ['read_file', 'list_dir', 'glob', 'grep'],
    blockedTools: [
      'write_file', 'edit_file',
      'bash', 'web_search', 'web_fetch', 'send_message', 'spawn_subagent',
    ],
    canSendMessage: false,
    canSpawnSubagents: false,
    canAccessMainHistory: false,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 8,
    maxToolCalls: 20,
    timeout: 180000,
  },

  planner: {
    role: 'planner',
    description: '规划 Agent，全局总控 + 动态路由（ADR 0024 director）',
    allowedTools: [
      'spawn_task', 'ask_user',
    ],
    blockedTools: ['write_file', 'edit_file', 'bash', 'web_search', 'web_fetch', 'generate_image'],
    canSendMessage: true,
    canSpawnSubagents: true,
    canAccessMainHistory: true,
    canWrite: false,
    canExecuteDangerous: false,
    maxIterations: 12,
    maxToolCalls: 40,
    timeout: 300000,
  },
};
