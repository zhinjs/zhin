/**
 * Owner 私聊指令：approve always / approve rule / list / revoke —— **bash + icqq 放行策略**。
 *
 * - **approve always bash**：永久跳过 bash 的 Owner 硬编排确认（ZHIN_NEEDS_OWNER）。
 * - **approve rule &lt;正则&gt;**：对 **整条** shell 子命令做正则匹配（如 `^icqq\\s+friend\\s+like\\b`），命中则敏感 icqq 也无需再确认；持久化。
 * - **approve list**：展示永久放行与规则列表。
 *
 * 支持前缀 `#`、`/` 或无符号。
 */
import { getPlugin, MessageCommand, type Message, type CommandFeature } from '@zhin.js/core';
import {
  addBashApproveRule,
  addOwnerApproveAlways,
  clearPendingOrchestrationTool,
  formatBashApproveList,
  getOwnerToolContextOrUndefined,
  getPendingOrchestrationTool,
  removeBashApproveRule,
  removeOwnerApproveAlways,
  OWNER_APPROVE_ALWAYS_TOOL,
} from '../security/owner-approve-always-store.js';

function usageLines(cmdPrefix: string): string {
  return [
    '用法（bash / icqq）：',
    `  ${cmdPrefix}approve always bash     — 永久跳过 bash 的 Owner 硬确认`,
    `  ${cmdPrefix}approve always         — 同上；须在近期 bash 私聊待确认窗口内`,
    `  ${cmdPrefix}approve rule <正则>   — 为敏感 icqq 命令增加放行规则（匹配整段子命令）`,
    `  ${cmdPrefix}approve list           — 列出永久放行与规则 id`,
    `  ${cmdPrefix}approve revoke rule <id> — 删除一条规则（id 可用 list 前 8 位）`,
    `  ${cmdPrefix}approve revoke         — 撤销 bash 永久放行（不删规则）`,
  ].join('\n');
}

function registerApproveCommandVariants(
  commandService: CommandFeature,
  pluginName: string,
  disposers: (() => void)[],
): void {
  const prefixes = ['', '#', '/'] as const;

  for (const p of prefixes) {
    const alwaysExplicit = new MessageCommand(`${p}approve always bash`)
      .desc('Owner：永久放行 bash 的在线安全确认', '仅私聊；写入 data/owner-approve-always.json')
      .usage(`${p}approve always bash`)
      .action((message: Message) => {
        const plugin = getPlugin().root ?? getPlugin();
        const ctx = getOwnerToolContextOrUndefined(plugin, message);
        if (!ctx) return '⚠️ 仅 Bot Owner 可在私聊中使用此指令。';
        const r = addOwnerApproveAlways(plugin, ctx, OWNER_APPROVE_ALWAYS_TOOL);
        if (!r.ok) return `⚠️ ${r.error}\n${usageLines(p)}`;
        return '✅ 已对 bash 永久放行 Owner 硬确认（本 Bot）。后续 bash 需确认时将不再弹窗；若当前仍有一条待回复的 bash 确认，本轮仍需输入 yes。';
      });
    commandService.add(alwaysExplicit, pluginName);
    disposers.push(() => commandService.remove(alwaysExplicit));

    const alwaysImplicit = new MessageCommand(`${p}approve always`)
      .desc('Owner：永久放行 bash（须在近期 bash 待确认窗口内）')
      .action((message: Message) => {
        const plugin = getPlugin().root ?? getPlugin();
        const ctx = getOwnerToolContextOrUndefined(plugin, message);
        if (!ctx) return '⚠️ 仅 Bot Owner 可在私聊中使用此指令。';
        const pending = getPendingOrchestrationTool(plugin, ctx);
        if (!pending) {
          return `⚠️ 无近期 bash 待确认上下文，请使用：${p}approve always bash。\n${usageLines(p)}`;
        }
        const r = addOwnerApproveAlways(plugin, ctx, pending);
        if (!r.ok) return `⚠️ ${r.error}`;
        clearPendingOrchestrationTool(plugin, ctx);
        return '✅ 已对 bash 永久放行 Owner 硬确认（本 Bot）。';
      });
    commandService.add(alwaysImplicit, pluginName);
    disposers.push(() => commandService.remove(alwaysImplicit));

    const revokeRuleCmd = new MessageCommand(`${p}approve revoke rule <id:text>`)
      .desc('Owner：按 id（或前 8 位前缀）删除一条放行正则')
      .action((message: Message, match) => {
        const plugin = getPlugin().root ?? getPlugin();
        const ctx = getOwnerToolContextOrUndefined(plugin, message);
        if (!ctx) return '⚠️ 仅 Bot Owner 可在私聊中使用此指令。';
        const id = String(match.params?.id ?? '').trim();
        if (!id) return `⚠️ 请提供规则 id。\n${usageLines(p)}`;
        const r = removeBashApproveRule(plugin, ctx, id);
        if (!r.ok) return `⚠️ ${r.error}`;
        return '✅ 已删除该放行规则。';
      });
    commandService.add(revokeRuleCmd, pluginName);
    disposers.push(() => commandService.remove(revokeRuleCmd));

    const ruleCmd = new MessageCommand(`${p}approve rule <pattern:text>`)
      .desc('Owner：添加 bash/icqq 放行正则（匹配整段待执行子命令）')
      .usage(`${p}approve rule ^icqq\\\\s+friend\\\\s+like\\\\b`)
      .action((message: Message, match) => {
        const plugin = getPlugin().root ?? getPlugin();
        const ctx = getOwnerToolContextOrUndefined(plugin, message);
        if (!ctx) return '⚠️ 仅 Bot Owner 可在私聊中使用此指令。';
        const raw = String(match.params?.pattern ?? '').trim();
        if (!raw) return `⚠️ 请提供正则。\n${usageLines(p)}`;
        const r = addBashApproveRule(plugin, ctx, raw);
        if (!r.ok) return `⚠️ ${r.error}`;
        return `✅ 已添加规则 id=${r.id.slice(0, 8)}… ，匹配子命令时将不再要求 Owner 确认（仍受危险命令黑名单等约束）。`;
      });
    commandService.add(ruleCmd, pluginName);
    disposers.push(() => commandService.remove(ruleCmd));

    const listCmd = new MessageCommand(`${p}approve list`)
      .desc('Owner：列出 bash 永久放行与正则规则')
      .action((message: Message) => {
        const plugin = getPlugin().root ?? getPlugin();
        const ctx = getOwnerToolContextOrUndefined(plugin, message);
        if (!ctx) return '⚠️ 仅 Bot Owner 可在私聊中使用此指令。';
        return formatBashApproveList(plugin, ctx);
      });
    commandService.add(listCmd, pluginName);
    disposers.push(() => commandService.remove(listCmd));

    const revokeCmd = new MessageCommand(`${p}approve revoke`)
      .desc('Owner：撤销 bash 永久放行（保留正则规则）')
      .action((message: Message) => {
        const plugin = getPlugin().root ?? getPlugin();
        const ctx = getOwnerToolContextOrUndefined(plugin, message);
        if (!ctx) return '⚠️ 仅 Bot Owner 可在私聊中使用此指令。';
        const r = removeOwnerApproveAlways(plugin, ctx, OWNER_APPROVE_ALWAYS_TOOL);
        if (!r.ok) return `⚠️ ${r.error}`;
        return '✅ 已撤销 bash 永久放行（正则规则仍保留，可用 approve list 查看）。';
      });
    commandService.add(revokeCmd, pluginName);
    disposers.push(() => commandService.remove(revokeCmd));
  }
}

export function registerOwnerApproveCommands(): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('command', (commandService) => {
    if (!commandService) return;
    const disposers: (() => void)[] = [];
    registerApproveCommandVariants(commandService, root.name, disposers);
    logger.debug(`Registered Owner approve (bash/icqq) commands (${disposers.length} patterns)`);
    return () => {
      for (const d of disposers) d();
    };
  });
}
