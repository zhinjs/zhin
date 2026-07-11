import { getActionFromMessage, type Message, type Plugin } from 'zhin.js';

const hintedChannels = new Set<string>();
const TTL_MS = 24 * 60 * 60 * 1000;
const channelHintAt = new Map<string, number>();

function channelHintKey(message: Message<any>): string {
  return `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
}

function pruneHintCache(): void {
  const now = Date.now();
  for (const [key, at] of channelHintAt) {
    if (now - at > TTL_MS) {
      channelHintAt.delete(key);
      hintedChannels.delete(key);
    }
  }
}

function messageMentionsBot(message: Message<any>): boolean {
  const raw = message.$raw ?? '';
  if (/@(?:everyone|all)/i.test(raw)) return false;
  const botId = message.$bot?.id;
  if (botId && raw.includes(String(botId))) return true;
  for (const item of message.$content ?? []) {
    if (typeof item === 'string') continue;
    if (item.type === 'at' && (!item.data.user_id || item.data.user_id === botId || item.data.user_id === 'all')) {
      if (item.data.user_id !== 'all') return true;
    }
  }
  return false;
}

function looksLikeCommand(raw: string): boolean {
  const t = raw.trim();
  return t.startsWith('/') || /^(游戏|game|帮助|help|签到|stats)\b/i.test(t);
}

/**
 * 群聊首次 @ 且非命令时提示 /游戏 /帮助（每频道 24h 最多一次）
 */
export function mountFirstAtHintMiddleware(root: Plugin): () => void {
  return root.addMiddleware(async (message, next) => {
    if (message.$channel.type !== 'group') return next();
    if (getActionFromMessage(message)) return next();
    if (!messageMentionsBot(message)) return next();

    const raw = message.$raw?.trim() ?? '';
    if (looksLikeCommand(raw)) return next();

    pruneHintCache();
    const key = channelHintKey(message);
    if (hintedChannels.has(key)) return next();

    hintedChannels.add(key);
    channelHintAt.set(key, Date.now());

    return next();
  });
}

/** 测试专用 */
export function resetOnboardingForTests(): void {
  hintedChannels.clear();
  channelHintAt.clear();
}
