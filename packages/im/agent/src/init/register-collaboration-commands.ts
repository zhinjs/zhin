/**
 * /collab 协作群管理指令（仅 master）。
 */
import { getPlugin, MessageCommand, OWNER_OPERATOR_PERMIT, type Message } from '@zhin.js/core';
import { normalizeCollaborationConfig } from '../collaboration/collaboration-config.js';
import {
  collabCommandUsage,
  handleCollabBind,
  handleCollabBindPrompt,
  handleCollabInitWizard,
  handleCollabInited,
  handleCollabInitCancel,
  handleCollabReset,
  handleCollabStatus,
  handleCollabUnbind,
} from '../collaboration/collaboration-commands.js';
import { extractAtTargets } from '../collaboration/init-observe-hook.js';

/** segment-matcher 默认读 user_id；icqq/qq 等适配器常用 qq 字段。 */
const AT_COMMAND_FIELD_MAP = { at: ['user_id', 'qq', 'id'] as const };

function readCollaborationConfig() {
  const plugin = getPlugin();
  const configService = plugin.root.inject('config');
  const primary = configService?.getPrimary<{ collaboration?: unknown }>() ?? {};
  return normalizeCollaborationConfig(primary.collaboration);
}

export function registerCollaborationCommands(): void {
  const collab = readCollaborationConfig();
  if (!collab.enabled) return;

  const plugin = getPlugin();
  const { root, useContext } = plugin;
  const config = collab;

  useContext('command', (commandService) => {
    if (!commandService) return;
    const disposers: (() => void)[] = [];

    const statusCmd = new MessageCommand('/collab')
      .desc('协作群状态与管理', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(async (message: Message) => handleCollabStatus(message));
    commandService.add(statusCmd, root.name);
    disposers.push(() => commandService.remove(statusCmd));

    const helpCmd = new MessageCommand('/collab help')
      .desc('协作群指令帮助', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(() => collabCommandUsage());
    commandService.add(helpCmd, root.name);
    disposers.push(() => commandService.remove(helpCmd));

    const initWizardCmd = new MessageCommand(
      '/collab init <planner:at>',
      { at: [...AT_COMMAND_FIELD_MAP.at] },
    )
      .desc('启动 init 向导（@ Planner Bot）', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(async (message: Message, matched) => {
        const plannerAtId = String(matched.params?.planner ?? '').trim()
          || extractAtTargets(message)[0]
          || '';
        if (!plannerAtId) return 'ℹ️ 用法：/collab init @PlannerBot';
        return handleCollabInitWizard(message, plannerAtId);
      });
    commandService.add(initWizardCmd, root.name);
    disposers.push(() => commandService.remove(initWizardCmd));

    const initedCmd = new MessageCommand('/collab inited')
      .desc('结束 init 向导并激活 Cell', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(async (message: Message) => handleCollabInited(message));
    commandService.add(initedCmd, root.name);
    disposers.push(() => commandService.remove(initedCmd));

    const initCancelCmd = new MessageCommand('/collab init-cancel')
      .desc('取消进行中的 init 向导', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(async (message: Message) => handleCollabInitCancel(message));
    commandService.add(initCancelCmd, root.name);
    disposers.push(() => commandService.remove(initCancelCmd));

    const bindCmd = new MessageCommand('/collab bind [adapter:word] [endpoint:text] [role:text]')
      .desc('向协作 Cell 添加 Bot 成员', '缺参时列出 adapter/endpoint', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(async (message: Message, matched) => {
        const adapter = String(matched.params?.adapter ?? '').trim();
        const endpoint = String(matched.params?.endpoint ?? '').trim();
        const role = String(matched.params?.role ?? '').trim();
        return handleCollabBindPrompt(
          message,
          adapter || undefined,
          endpoint || undefined,
          role || undefined,
        );
      });
    commandService.add(bindCmd, root.name);
    disposers.push(() => commandService.remove(bindCmd));

    const bindPrimaryCmd = new MessageCommand('/collab bind <adapter:word> <endpoint:text> <role:text> <primary:text>')
      .desc('添加成员并指定 primary 名', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(async (message: Message, matched) => {
        const adapter = String(matched.params?.adapter ?? '').trim();
        const endpoint = String(matched.params?.endpoint ?? '').trim();
        const role = String(matched.params?.role ?? '').trim();
        const primary = String(matched.params?.primary ?? '').trim();
        if (!endpoint || !role) {
          return handleCollabBindPrompt(
            message,
            adapter || undefined,
            endpoint || undefined,
            role || undefined,
            primary || undefined,
          );
        }
        return handleCollabBind(message, endpoint, role, primary, adapter || undefined);
      });
    commandService.add(bindPrimaryCmd, root.name);
    disposers.push(() => commandService.remove(bindPrimaryCmd));

    const unbindCmd = new MessageCommand('/collab unbind <endpoint:text>')
      .desc('从协作 Cell 移除成员', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(async (message: Message, matched) => {
        const endpoint = String(matched.params?.endpoint ?? '').trim();
        if (!endpoint) return 'ℹ️ 用法：/collab unbind <endpoint>';
        return handleCollabUnbind(message, endpoint);
      });
    commandService.add(unbindCmd, root.name);
    disposers.push(() => commandService.remove(unbindCmd));

    const resetCmd = new MessageCommand('/collab reset')
      .desc('重置 pipeline（保留 Cell）', '仅 master')
      .permit(OWNER_OPERATOR_PERMIT)
      .action(async (message: Message) => handleCollabReset(message));
    commandService.add(resetCmd, root.name);
    disposers.push(() => commandService.remove(resetCmd));

    return () => disposers.forEach((d) => d());
  });
}
