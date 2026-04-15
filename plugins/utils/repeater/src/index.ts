/**
 * @zhin.js/plugin-repeater
 *
 * 复读机插件 —— 当群内连续多人发送相同消息时自动跟读
 *
 * 规则：
 *   - 同一群聊内，连续 N 人（默认 3）发送完全相同的消息后触发复读
 *   - 同一用户的连续消息不计入（防止单人刷屏触发）
 *   - 每条消息在同一群只复读一次
 *   - 可配置中断策略（不同消息会重置计数）
 *   - 支持冷却时间防止频繁复读
 *
 * 命令：
 *   repeater-status    查看当前复读机状态
 *
 * 配置（zhin.config.yml）：
 * ```yaml
 * plugins:
 *   - "@zhin.js/plugin-repeater"
 * repeater:
 *   threshold: 3
 *   cooldown: 30000
 *   maxLength: 200
 * ```
 */
import { usePlugin, MessageCommand, Schema } from "zhin.js";

const plugin = usePlugin();
const { logger, addCommand, addMiddleware, onDispose, declareConfig } = plugin;

const config = declareConfig("repeater", Schema.object({
  threshold: Schema.number().default(3).min(2).max(10).description("触发复读的最少人数"),
  cooldown: Schema.number().default(30_000).min(5000).max(300_000).description("同一群冷却时间 (ms)"),
  maxLength: Schema.number().default(200).min(10).max(1000).description("消息长度上限"),
}));

interface RepeatState {
  content: string;
  users: Set<string>;
  repeated: boolean;
  lastTime: number;
}

const groupStates = new Map<string, RepeatState>();

const cooldownSet = new Map<string, number>();

function getGroupId(message: any): string | null {
  if (message.type !== "group") return null;
  return String(message.$group?.id || message.$target?.id || "");
}

function getSenderId(message: any): string {
  return String(message.$sender?.id || "");
}

let totalRepeats = 0;

addMiddleware(async function repeaterMiddleware(message: any, next: () => Promise<void>) {
  const groupId = getGroupId(message);
  if (!groupId) return next();

  const content = (message.$raw || "").trim();
  if (!content || content.length > config.maxLength) return next();

  const senderId = getSenderId(message);
  if (!senderId) return next();

  const state = groupStates.get(groupId);

  if (state && state.content === content) {
    if (state.users.has(senderId)) return next();

    state.users.add(senderId);
    state.lastTime = Date.now();

    if (state.users.size >= config.threshold && !state.repeated) {
      const lastCd = cooldownSet.get(groupId);
      if (lastCd && Date.now() - lastCd < config.cooldown) {
        return next();
      }

      state.repeated = true;
      cooldownSet.set(groupId, Date.now());
      totalRepeats++;

      await message.$reply(content);
      return;
    }
  } else {
    groupStates.set(groupId, {
      content,
      users: new Set([senderId]),
      repeated: false,
      lastTime: Date.now(),
    });
  }

  return next();
});

const staleCleanup = setInterval(() => {
  const now = Date.now();
  const expiry = 5 * 60_000;
  for (const [key, state] of groupStates) {
    if (now - state.lastTime > expiry) groupStates.delete(key);
  }
  for (const [key, time] of cooldownSet) {
    if (now - time > config.cooldown * 2) cooldownSet.delete(key);
  }
}, 120_000);

onDispose(() => {
  clearInterval(staleCleanup);
  groupStates.clear();
  cooldownSet.clear();
});

addCommand(
  new MessageCommand("repeater-status")
    .desc("复读机状态", "查看复读机的运行状态")
    .action(async () => {
      const activeGroups = groupStates.size;
      const lines = [
        "复读机状态",
        `监控群数: ${activeGroups}`,
        `触发阈值: ${config.threshold} 人`,
        `冷却时间: ${config.cooldown / 1000}s`,
        `消息长度上限: ${config.maxLength}`,
        `累计复读: ${totalRepeats} 次`,
      ];
      return lines.join("\n");
    }),
);

logger.info(`插件已加载 (阈值=${config.threshold}人, 冷却=${config.cooldown / 1000}s)`);
