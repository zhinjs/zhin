import { defineCommand, type CommandSegment } from 'zhin.js/command';
import { Actions, getIcqqAgentDeps } from '@zhin.js/adapter-icqq';

const MAX_TIMES = 20;
const DEFAULT_TIMES = 10;

function clampTimes(value: number): number {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_TIMES;
  return Math.min(MAX_TIMES, Math.floor(value));
}

function segmentTypeName(type: CommandSegment['type']): string {
  return typeof type === 'string' ? type : type.name;
}

function mentionTarget(segments: readonly Readonly<CommandSegment>[]): number | undefined {
  for (const segment of segments) {
    const type = segmentTypeName(segment.type);
    if (type !== 'mention' && type !== 'at') continue;
    const raw = segment.data.target ?? segment.data.qq ?? segment.data.user_id ?? segment.data.id;
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return undefined;
}

function looksLikeQq(token: string): boolean {
  return /^\d{5,11}$/.test(token);
}

/** 解析目标 QQ 与次数：赞我 / 赞我 10 / 赞我 @人 10 / 赞我 123456 10 */
export function parseZanArgs(input: {
  readonly args: readonly string[];
  readonly segments: readonly Readonly<CommandSegment>[];
  readonly senderId?: string;
}): { userId: number; times: number } | { error: string } {
  const mentioned = mentionTarget(input.segments);
  const tokens = [...input.args];

  if (mentioned != null) {
    const timesToken = tokens.find((t) => /^\d+$/.test(t));
    return {
      userId: mentioned,
      times: clampTimes(timesToken ? Number(timesToken) : DEFAULT_TIMES),
    };
  }

  if (tokens.length === 0) {
    const sender = Number(input.senderId);
    if (!Number.isFinite(sender) || sender <= 0) {
      return { error: '用法: 赞我 [@用户|QQ号] [次数1-20]\n例: 赞我 / 赞我 10 / 赞我 @张三 10 / 赞我 123456789 10' };
    }
    return { userId: sender, times: DEFAULT_TIMES };
  }

  if (tokens.length === 1) {
    const only = tokens[0]!;
    if (looksLikeQq(only)) {
      return { userId: Number(only), times: DEFAULT_TIMES };
    }
    if (/^\d+$/.test(only)) {
      const sender = Number(input.senderId);
      if (!Number.isFinite(sender) || sender <= 0) {
        return { error: '缺少目标用户，请 @某人 或写 QQ 号' };
      }
      return { userId: sender, times: clampTimes(Number(only)) };
    }
    return { error: '参数无效。用法: 赞我 [@用户|QQ号] [次数1-20]' };
  }

  const userToken = tokens.find(looksLikeQq) ?? tokens[0]!;
  const timesToken = tokens.find((t, i) => i > 0 && /^\d+$/.test(t)) ?? tokens[1]!;
  if (!looksLikeQq(userToken)) {
    return { error: '目标 QQ 无效。用法: 赞我 <QQ号> [次数]' };
  }
  return { userId: Number(userToken), times: clampTimes(Number(timesToken)) };
}

/** ICQQ 点赞（竖大拇指）。每人每天约最多 20 次。 */
export default defineCommand({
  description: 'ICQQ 点赞：赞我 [@用户|QQ号] [次数]',
  alias: ['zan'],
  permit: ['adapter(icqq)'],
  execute: async ({ endpoint, sender, args, segments }) => {
    if (!endpoint) {
      return '无法解析当前 ICQQ Endpoint';
    }

    const parsed = parseZanArgs({
      args,
      segments,
      senderId: sender?.id,
    });
    if ('error' in parsed) return parsed.error;

    try {
      const bot = getIcqqAgentDeps().getEndpoint(endpoint);
      const resp = await bot.ipc.request(Actions.FRIEND_LIKE, {
        user_id: parsed.userId,
        times: parsed.times,
      });
      if (!resp.ok) {
        return `点赞失败：${resp.error ?? '未知错误'}`;
      }
      return `已给 ${parsed.userId} 点赞 ${parsed.times} 次`;
    } catch (error) {
      return `点赞失败：${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
