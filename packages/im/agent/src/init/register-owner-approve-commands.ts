/**
 * Owner 私聊指令：approve always / approve rule / list / revoke —— **bash + icqq 放行策略**。
 *
 */
import { getPlugin, MessageCommand, type Message, type CommandFeature } from '@zhin.js/core';
import {
  addBashApproveRule,
  addOwnerApproveAlways,
  clearPendingOrchestrationTool,
  formatBashApproveList,
  getOwnerCommMessageOrUndefined,
  getPendingOrchestrationTool,
  removeBashApproveRule,
  removeOwnerApproveAlways,
  OWNER_APPROVE_ALWAYS_TOOL,
} from '../security/owner-approve-always-store.js';

function usageLines(): string {
  return [
    '用法（bash / icqq）：',
    '  /approve always bash     — 永久跳过 bash 的 Owner 硬确认',
    '  /approve always         — 同上；须在近期 bash 私聊待确认窗口内',
    '  /approve rule <正则>   — 为敏感 icqq 命令增加放行规则（匹配整段子命令）',
    '  /approve list           — 列出永久放行与规则 id',
    '  /approve revoke rule <id> — 删除一条规则（id 可用 list 前 8 位）',
    '  /approve revoke         — 撤销 bash 永久放行（不删规则）',
  ].join('\n');
}

function registerApproveCommands(
  commandService: CommandFeature,
  pluginName: string,
  root: ReturnType<typeof getPlugin>['root'],
  disposers: (() => void)[],
): void {
  const alwaysExplicit = new MessageCommand('/approve always bash')
    .desc('Owner：永久放行 bash 的在线安全确认', '仅私聊；写入 data/owner-approve-always.json')
    .usage('/approve always bash')
    .action((message: Message) => {
      const ctx = getOwnerCommMessageOrUndefined(root, message);
      if (!ctx) return '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。';
      const r = addOwnerApproveAlways(root, ctx, OWNER_APPROVE_ALWAYS_TOOL);
      if (!r.ok) return `⚠️ ${r.error}\n${usageLines()}`;
      return '✅ 已对 bash 永久放行 Owner 硬确认（本 Bot）。后续 bash 需确认时将不再弹窗；若当前仍有一条待回复的 bash 确认，本轮仍需输入 yes。';
    });
  commandService.add(alwaysExplicit, pluginName);
  disposers.push(() => commandService.remove(alwaysExplicit));

  const alwaysImplicit = new MessageCommand('/approve always')
    .desc('Owner：永久放行 bash（须在近期 bash 待确认窗口内）')
    .action((message: Message) => {
      const ctx = getOwnerCommMessageOrUndefined(root, message);
      if (!ctx) return '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。';
      const pending = getPendingOrchestrationTool(root, ctx);
      if (!pending) {
        return `⚠️ 无近期 bash 待确认上下文，请使用：/approve always bash。\n${usageLines()}`;
      }
      const r = addOwnerApproveAlways(root, ctx, pending);
      if (!r.ok) return `⚠️ ${r.error}`;
      clearPendingOrchestrationTool(root, ctx);
      return '✅ 已对 bash 永久放行 Owner 硬确认（本 Bot）。';
    });
  commandService.add(alwaysImplicit, pluginName);
  disposers.push(() => commandService.remove(alwaysImplicit));

  const revokeRuleCmd = new MessageCommand('/approve revoke rule <id:text>')
    .desc('Owner：按 id（或前 8 位前缀）删除一条放行正则')
    .action((message: Message, match) => {
      const ctx = getOwnerCommMessageOrUndefined(root, message);
      if (!ctx) return '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。';
      const id = String(match.params?.id ?? '').trim();
      if (!id) return `⚠️ 请提供规则 id。\n${usageLines()}`;
      const r = removeBashApproveRule(root, ctx, id);
      if (!r.ok) return `⚠️ ${r.error}`;
      return '✅ 已删除该放行规则。';
    });
  commandService.add(revokeRuleCmd, pluginName);
  disposers.push(() => commandService.remove(revokeRuleCmd));

  const ruleCmd = new MessageCommand('/approve rule <pattern:text>')
    .desc('Owner：添加 bash/icqq 放行正则（匹配整段待执行子命令）')
    .usage('/approve rule ^icqq\\\\s+friend\\\\s+like\\\\b')
    .action((message: Message, match) => {
      const ctx = getOwnerCommMessageOrUndefined(root, message);
      if (!ctx) return '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。';
      const raw = String(match.params?.pattern ?? '').trim();
      if (!raw) return `⚠️ 请提供正则。\n${usageLines()}`;
      const r = addBashApproveRule(root, ctx, raw);
      if (!r.ok) return `⚠️ ${r.error}`;
      return `✅ 已添加规则 id=${r.id.slice(0, 8)}… ，匹配子命令时将不再要求 Owner 确认（仍受危险命令黑名单等约束）。`;
    });
  commandService.add(ruleCmd, pluginName);
  disposers.push(() => commandService.remove(ruleCmd));

  const listCmd = new MessageCommand('/approve list')
    .desc('Owner：列出 bash 永久放行与正则规则')
    .action((message: Message) => {
      const ctx = getOwnerCommMessageOrUndefined(root, message);
      if (!ctx) return '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。';
      return formatBashApproveList(root, ctx);
    });
  commandService.add(listCmd, pluginName);
  disposers.push(() => commandService.remove(listCmd));

  const revokeCmd = new MessageCommand('/approve revoke')
    .desc('Owner：撤销 bash 永久放行（保留正则规则）')
    .action((message: Message) => {
      const ctx = getOwnerCommMessageOrUndefined(root, message);
      if (!ctx) return '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。';
      const r = removeOwnerApproveAlways(root, ctx, OWNER_APPROVE_ALWAYS_TOOL);
      if (!r.ok) return `⚠️ ${r.error}`;
      return '✅ 已撤销 bash 永久放行（正则规则仍保留，可用 /approve list 查看）。';
    });
  commandService.add(revokeCmd, pluginName);
  disposers.push(() => commandService.remove(revokeCmd));
}

export function registerOwnerApproveCommands(): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('command', (commandService) => {
    if (!commandService) return;
    const disposers: (() => void)[] = [];
    registerApproveCommands(commandService, root.name, root, disposers);
    logger.debug(`Registered Owner approve (bash/icqq) commands (${disposers.length} patterns)`);
    return () => {
      for (const d of disposers) d();
    };
  });
}
