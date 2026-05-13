/**
 * Owner 确认信号（ZHIN_NEEDS_OWNER）与白名单硬编排（GitHub #398）
 *
 * 阶段 A：工具结果首行 `ZHIN_NEEDS_OWNER:` 为权威信号。
 * 阶段 B：白名单工具 + 信号 + 非子 Agent 时由本模块同步调用 ask_user(type=confirm)。
 */
import { getPlugin } from '@zhin.js/core';
import type { Plugin, ToolContext } from '@zhin.js/core';
import type { ToolResultTransform } from '@zhin.js/ai';
import { AskUserBuiltinTool } from '../builtin/ask-user-tool.js';
import { errMsg } from '../discovery/utils.js';
import {
  clearPendingOrchestrationTool,
  hasOwnerApproveAlways,
  setPendingOrchestrationTool,
} from '../security/owner-approve-always-store.js';
import { OWNER_HARD_ORCHESTRATION_TOOLS } from './owner-orchestration-constants.js';

/** 工具结果第一行须与此完全一致（行首无空白） */
export const ZHIN_NEEDS_OWNER_FIRST_LINE = 'ZHIN_NEEDS_OWNER:' as const;

export { OWNER_HARD_ORCHESTRATION_TOOLS } from './owner-orchestration-constants.js';

const WHITELIST = new Set<string>(OWNER_HARD_ORCHESTRATION_TOOLS);

const DEFAULT_MAX_AUTO_ASK = 3;

export interface OwnerOrchestrationOptions {
  toolContext: ToolContext;
  /** 子 Agent 内为 true：仅保留信号，不执行 B */
  disableHardOrchestration?: boolean;
  /** 每根任务自动 ask_user 上限，默认 3 */
  maxAutoOwnerAsk?: number;
  /**
   * 当前 Bot 插件实例。生产路径可由 {@link ZhinAgent} 传入 `getPlugin()`；
   * 单测注入桩对象，避免依赖对 `@zhin.js/core` 的全局 mock（与 Vitest 模块缓存冲突）。
   */
  plugin?: Plugin;
}

/**
 * 解析权威首行；正文为第二行起（可含多行）。
 */
export function parseNeedsOwnerSignal(result: string): { hasSignal: boolean; body: string } {
  const lines = result.split(/\r?\n/);
  const first = lines[0] ?? '';
  if (first !== ZHIN_NEEDS_OWNER_FIRST_LINE) {
    return { hasSignal: false, body: result };
  }
  const body = lines.slice(1).join('\n').replace(/^\n+/, '');
  return { hasSignal: true, body };
}

export function shouldHardOrchestrateOwnerConfirm(toolName: string, result: string): boolean {
  if (!WHITELIST.has(toolName)) return false;
  return parseNeedsOwnerSignal(result).hasSignal;
}

function appendOrchestratedOwnerAnswer(originalToolText: string, ownerAnswer: string): string {
  return `${originalToolText.trimEnd()}\n\n---\n[Owner confirmation (orchestrated)]\n${ownerAnswer}`;
}

function appendUnavailableNote(originalToolText: string, note: string): string {
  return `${originalToolText.trimEnd()}\n\n---\n⚠️ 无法自动收集 Owner 在线确认：${note}\n请 Bot Owner 配置 owner 与私聊通道，或由助手向用户说明下一步。`;
}

function appendLimitNote(originalToolText: string, maxAsk: number): string {
  return `${originalToolText.trimEnd()}\n\n---\n⚠️ 本会话自动 Owner 确认次数已达上限（${maxAsk} 次），不再自动弹窗。\n权威行 ${ZHIN_NEEDS_OWNER_FIRST_LINE} 仍然有效，请用文字向用户或 Owner 说明结果与风险。`;
}

function buildConfirmQuestion(toolName: string, body: string): string {
  const trimmed = body.trim() || '（无补充说明）';
  const cap = 2000;
  const detail = trimmed.length > cap ? `${trimmed.slice(0, cap)}\n…(truncated)` : trimmed;
  return `工具「${toolName}」需要 Owner 确认是否继续：\n\n${detail}`;
}

/**
 * 为单次 Agent.run 创建工具结果变换：在写入对话前可能插入 Owner confirm 结果。
 */
export function createOwnerOrchestratedToolResultTransform(
  options: OwnerOrchestrationOptions,
): ToolResultTransform {
  const maxAsk = options.maxAutoOwnerAsk ?? DEFAULT_MAX_AUTO_ASK;
  let usedOrchestrationSlots = 0;

  return async (input): Promise<string> => {
    const { toolName, result } = input;
    if (!shouldHardOrchestrateOwnerConfirm(toolName, result)) return result;
    if (options.disableHardOrchestration) return result;

    if (usedOrchestrationSlots >= maxAsk) {
      return appendLimitNote(result, maxAsk);
    }

    let plugin: Plugin | undefined = options.plugin;
    if (!plugin) {
      try {
        plugin = getPlugin();
      } catch (e: unknown) {
        return appendUnavailableNote(result, errMsg(e));
      }
    }

    const askTool = new AskUserBuiltinTool(plugin);
    const { body } = parseNeedsOwnerSignal(result);
    const question = buildConfirmQuestion(toolName, body);

    if (toolName === 'bash' && hasOwnerApproveAlways(plugin, options.toolContext, toolName)) {
      return appendOrchestratedOwnerAnswer(result, 'yes');
    }

    if (toolName === 'bash') {
      setPendingOrchestrationTool(plugin, options.toolContext, toolName);
    }
    try {
      const ownerRaw = await askTool.run(
        { question, type: 'confirm', timeout: 120 },
        options.toolContext,
      );
      const ownerStr = typeof ownerRaw === 'string' ? ownerRaw : String(ownerRaw);

      if (ownerStr.startsWith('Error:')) {
        return appendUnavailableNote(result, ownerStr);
      }

      usedOrchestrationSlots++;
      return appendOrchestratedOwnerAnswer(result, ownerStr.trim());
    } finally {
      if (toolName === 'bash') {
        clearPendingOrchestrationTool(plugin, options.toolContext);
      }
    }
  };
}
