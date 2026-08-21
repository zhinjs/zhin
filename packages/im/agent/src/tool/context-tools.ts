/**
 * 运行时上下文工具（session / profile），由 ToolSystem 按 turn 注入。
 */
import type { AgentTool } from '@zhin.js/ai';
import type { UserProfileStore } from '../user-profile.js';
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
