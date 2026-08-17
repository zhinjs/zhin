/**
 * Plugin Runtime 管理命令面（替代 legacy MessageCommand 注册）。
 *
 * 对齐 migrate-zhin-plugin-runtime：命令逻辑与 CommandFeature 解耦，
 * 由 Agent Host unmatched 前拦截；legacy `initAgentModule` 不再挂 MessageCommand。
 */
import type { AIService } from '../service.js';
import { asPrivate } from '../internal/as-private.js';
import {
  jumpSessionTree,
  listSessionTree,
} from '../session/session-tree-commands.js';
import type { ZhinAgent } from '../zhin-agent/index.js';

export type RuntimeManagementSenderRoles = {
  readonly isMaster: boolean;
  readonly isTrusted: boolean;
};

export type RuntimeManagementDeps = {
  readonly service: AIService;
  readonly zhinAgent: ZhinAgent;
  readonly sessionKey: string;
  readonly content: string;
  readonly senderRoles: RuntimeManagementSenderRoles;
};

function denyOperator(): string {
  return '⚠️ 仅 master / trusted 可使用此管理指令。';
}

function parseLeadingInt(rest: string): number | undefined {
  const n = Number.parseInt(rest.trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/**
 * 若 `content` 是管理命令则返回回复文案；否则 `null`（交回 AI / 其它处理）。
 */
export async function handleRuntimeManagementCommand(
  deps: RuntimeManagementDeps,
): Promise<string | null> {
  const text = deps.content.trim();
  if (!text) return null;

  const isOperator = deps.senderRoles.isMaster || deps.senderRoles.isTrusted;
  const agent = asPrivate(deps.zhinAgent);

  if (/^\/models\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    const models = await deps.service.listModels();
    let r = '🤖 可用模型:\n';
    for (const { provider, models: ml } of models) {
      r += `\n【${provider}】\n` + ml.slice(0, 5).map((m) => `  • ${m}`).join('\n');
      if (ml.length > 5) r += `\n  ... 还有 ${ml.length - 5} 个`;
    }
    return r;
  }

  if (/^\/tree\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    return listSessionTree(agent, deps.sessionKey);
  }

  const treeJump = text.match(/^\/tree\s+(\d+)\s*$/iu);
  if (treeJump) {
    if (!isOperator) return denyOperator();
    const n = parseLeadingInt(treeJump[1] ?? '');
    if (n == null) return 'ℹ️ 用法：/tree 2';
    return jumpSessionTree(agent, deps.sessionKey, n);
  }

  const fork = text.match(/^\/fork\s+(\d+)\s*$/iu);
  if (fork) {
    if (!isOperator) return denyOperator();
    const n = parseLeadingInt(fork[1] ?? '');
    if (n == null) return 'ℹ️ 用法：/fork 2';
    return jumpSessionTree(agent, deps.sessionKey, n);
  }

  if (/^\/compact\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    const result = await deps.zhinAgent.compactSession(deps.sessionKey);
    return result.ok ? `✅ ${result.message}` : `ℹ️ ${result.message}`;
  }

  if (/^\/reset\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    const ok = await deps.zhinAgent.archiveSession(deps.sessionKey);
    return ok ? '✅ 已归档当前会话，下次 @ 将使用新上下文' : 'ℹ️ 无活跃会话可归档';
  }

  if (/^ai\.health\s*$/iu.test(text)) {
    if (!isOperator) return denyOperator();
    const health = await deps.service.healthCheck();
    return ['🏥 AI 服务健康状态:'].concat(
      Object.entries(health).map(([p, ok]) => `  ${ok ? '✅' : '❌'} ${p}`),
    ).join('\n');
  }

  return null;
}
