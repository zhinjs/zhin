/**
 * 运行时上下文工具（session / profile），由 ToolSystem 按 turn 注入。
 */
import type { AgentTool } from '@zhin.js/ai';
import type { ImTranscriptQuery, ImTranscriptSearchHit, ImTranscriptStore, MemoryImTranscriptStore } from '@zhin.js/ai';
import type { UserProfileStore } from '../user-profile.js';

function formatTranscriptHitLine(hit: ImTranscriptSearchHit): string {
  const role = hit.direction === 'inbound' ? '用户' : '助手';
  const time = new Date(hit.time).toLocaleString('zh-CN');
  const who = hit.senderName && hit.direction === 'inbound' ? ` (${hit.senderName})` : '';
  return `[${time}] ${role}${who}: ${hit.body}`;
}

function formatTranscriptToolResult(
  result: { messages: ImTranscriptSearchHit[] },
  header: string,
): string {
  let output = header;
  if (result.messages.length > 0) {
    output += `\n\n💬 聊天记录：\n${result.messages.map(formatTranscriptHitLine).join('\n')}`;
  } else {
    output += '\n\n未找到相关聊天记录。';
  }
  return output;
}

type TranscriptHistoryReader = Pick<ImTranscriptStore, 'search' | 'listRecent'> | Pick<MemoryImTranscriptStore, 'search' | 'listRecent'>;

export function createImTranscriptHistoryTool(
  store: TranscriptHistoryReader,
  query: ImTranscriptQuery,
): AgentTool {
  return {
    name: 'chat_history',
    source: 'builtin:context',
    description:
      '从 im_transcripts 按需查询本场景历史聊天（platform+bot+群/私聊）。支持关键词模糊搜索 body；keyword 留空则返回最近若干条。当用户问「之前聊过什么」「我们讨论过什么」时使用。',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词（匹配消息正文）。留空则返回最近记录',
        },
        limit: {
          type: 'number',
          description: '最多返回条数（默认 10，最大 100）',
        },
      },
    },
    tags: ['memory', 'history', '聊天记录', '回忆', '之前'],
    keywords: ['之前', '历史', '聊过', '讨论过', '记得', '上次', '以前', '回忆'],
    async execute(args: Record<string, unknown>) {
      const keyword = typeof args.keyword === 'string' ? args.keyword : '';
      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.floor(args.limit)
          : 10;

      if (keyword.trim()) {
        const result = await store.search(query, keyword, limit);
        return formatTranscriptToolResult(
          result,
          `关键词「${keyword.trim()}」的搜索结果（最多 ${limit} 条）：`,
        );
      }

      const result = await store.listRecent(query, limit);
      return formatTranscriptToolResult(result, `最近 ${limit} 条聊天记录：`);
    },
  };
}

export function createUserProfileTool(userId: string, profiles: UserProfileStore): AgentTool {
  return {
    name: 'user_profile',
    source: 'builtin:context',
    description: '读取或保存用户的个人偏好和信息。当用户告诉你他的名字、偏好、兴趣、习惯等个人信息时，用 set 操作保存。当需要了解用户偏好时，用 get 操作读取。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型: get（读取所有偏好）, set（保存偏好）, delete（删除偏好）',
          enum: ['get', 'set', 'delete'],
        },
        key: {
          type: 'string',
          description: '偏好名称，如: name, style, interests, timezone, language 等',
        },
        value: {
          type: 'string',
          description: '偏好值（仅 set 操作需要）。language / preferred_language 会影响回复与 web_search 的 Bing 市场语言。',
        },
      },
      required: ['action'],
    },
    tags: ['profile', '偏好', '用户', '个性化', '记住'],
    keywords: ['我叫', '我的名字', '记住我', '我喜欢', '我偏好', '我习惯', '叫我', '我是'],
    async execute(args: Record<string, unknown>) {
      const action = typeof args.action === 'string' ? args.action : '';
      const key = typeof args.key === 'string' ? args.key : '';
      const value = typeof args.value === 'string' ? args.value : '';

      switch (action) {
        case 'get': {
          const all = await profiles.getAll(userId);
          const entries = Object.entries(all);
          if (entries.length === 0) return '暂无保存的用户偏好。';
          return '用户偏好：\n' + entries.map(([k, v]) => `  ${k}: ${v}`).join('\n');
        }
        case 'set': {
          if (!key || !value) return '需要提供 key 和 value';
          await profiles.set(userId, key, value);
          return `已保存: ${key} = ${value}`;
        }
        case 'delete': {
          if (!key) return '需要提供 key';
          const deleted = await profiles.delete(userId, key);
          return deleted ? `已删除: ${key}` : `未找到偏好: ${key}`;
        }
        default:
          return '不支持的操作，请使用 get/set/delete';
      }
    },
  };
}
