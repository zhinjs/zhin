/**
 * 运行时上下文工具（session / profile），由 ToolSystem 按 turn 注入。
 */
import type { AgentTool } from '@zhin.js/ai';
import { USER_PROFILE_KEYS, normalizeUserProfileKey, type UserProfileStore } from '../user-profile.js';
import type { SessionScope } from '../session-profile.js';
export function createUserProfileTool(userId: string, profiles: UserProfileStore, platform?: string): AgentTool {
  const relations = platform ? profiles.relations : undefined;
  const actions = relations ? ['get', 'set', 'delete', 'note', 'unnote', 'call_me', 'tone'] : ['get', 'set', 'delete'];
  return {
    name: 'user_profile',
    source: 'builtin:context',
    description: relations
      ? '读取或保存当前用户的偏好与画像。偏好用 set/get/delete；值得记住的短事实或梗用 note（≤60 字，不要记密码、验证码、证件号等敏感信息），unnote 删除；用户希望怎么被称呼用 call_me；跟这人怎么说话用 tone（逗号分隔的短标签）。'
      : '读取或保存用户的个人偏好和信息。当用户告诉你他的名字、偏好、兴趣、习惯等个人信息时，用 set 操作保存。当需要了解用户偏好时，用 get 操作读取。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: relations
            ? '操作类型: get（读取偏好与画像）, set/delete（偏好）, note（记一条短事实/梗）, unnote（按关键字删笔记）, call_me（称呼）, tone（语气标签）'
            : '操作类型: get（读取所有偏好）, set（保存偏好）, delete（删除偏好）',
          enum: actions,
        },
        key: {
          type: 'string',
          enum: [...USER_PROFILE_KEYS],
          description: '偏好维度（固定 8 个，同一维度覆盖写入）: name 名字, language 回复语言, timezone 时区, style 回复风格, interests 兴趣, dislikes 不喜欢的, occupation 职业, location 所在地。其他内容用 note。',
        },
        value: {
          type: 'string',
          description: '偏好值（set 需要）；note/unnote/call_me/tone 的内容也放这里。language / preferred_language 会影响回复语言。',
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
          const lines = entries.length === 0 ? ['暂无保存的用户偏好。'] : ['用户偏好：', ...entries.map(([k, v]) => `  ${k}: ${v}`)];
          if (relations && platform) {
            const record = await relations.get(platform, userId);
            if (record?.preferredAddress) lines.push(`称呼: ${record.preferredAddress}`);
            if (record?.toneHints.length) lines.push(`语气: ${record.toneHints.join(', ')}`);
            if (record?.notes.length) lines.push(`笔记: ${record.notes.join('; ')}`);
          }
          return lines.join('\n');
        }
        case 'note': {
          if (!relations || !platform) break;
          return await relations.addNote(platform, userId, value) ? '已记下。' : '没记：内容为空或像是敏感信息。';
        }
        case 'unnote': {
          if (!relations || !platform) break;
          return await relations.removeNote(platform, userId, value) ? '已删掉相关笔记。' : '没找到相关笔记。';
        }
        case 'call_me': {
          if (!relations || !platform) break;
          return await relations.setPreferredAddress(platform, userId, value) ? `好，之后称呼「${value.trim()}」。` : '这个称呼没法保存。';
        }
        case 'tone': {
          if (!relations || !platform) break;
          const saved = await relations.setToneHints(platform, userId, value.split(/[,，、]/));
          return saved.length ? `语气标签: ${saved.join(', ')}` : '已清空语气标签。';
        }
        case 'set': {
          if (!key || !value) return '需要提供 key 和 value';
          const normalized = normalizeUserProfileKey(key);
          if (!normalized) return `不支持的偏好维度: ${key}。只能用 ${USER_PROFILE_KEYS.join('/')}；其他内容用 note。`;
          if (!await profiles.set(userId, normalized, value)) return '没保存：内容为空或像是敏感信息。';
          return `已保存: ${normalized} = ${(await profiles.get(userId, normalized)) ?? ''}`;
        }
        case 'delete': {
          if (!key) return '需要提供 key';
          const deleted = await profiles.delete(userId, key);
          return deleted ? `已删除: ${key}` : `未找到偏好: ${key}`;
        }
        default:
          break;
      }
      return `不支持的操作，请使用 ${actions.join('/')}`;
    },
  };
}

/**
 * 会话画像：多人会话（群/频道）的话题。仅在群/频道回合提供；覆盖式写入，最多 5 条。
 */
export function createSessionProfileTool(
  profiles: UserProfileStore,
  scene: { platform: string; scope: Exclude<SessionScope, 'private'>; sceneId: string },
): AgentTool {
  return {
    name: 'session_profile',
    source: 'builtin:context',
    description: '读取或更新当前群/频道的会话画像。get 查看话题与概况；当聊天话题明显换了或出现长期话题时，用 topics 覆盖写入当前话题（逗号分隔，最多 5 个短语，不要写个人隐私）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'topics'], description: 'get（查看）或 topics（覆盖当前话题）' },
        value: { type: 'string', description: 'topics 时为逗号分隔的话题短语' },
      },
      required: ['action'],
    },
    tags: ['session', '会话', '话题', '群'],
    keywords: ['话题', '在聊什么', 'topic'],
    async execute(args: Record<string, unknown>) {
      const action = typeof args.action === 'string' ? args.action : '';
      const value = typeof args.value === 'string' ? args.value : '';
      const sessions = profiles.sessions;
      if (action === 'get') {
        const summary = sessions.buildSummary(await sessions.get(scene.platform, scene.scope, scene.sceneId));
        return summary || '暂无会话画像。';
      }
      if (action === 'topics') {
        const saved = await sessions.setTopics(scene.platform, scene.scope, scene.sceneId, value.split(/[,，、;；]/));
        return saved.length ? `当前话题: ${saved.join('; ')}` : '已清空话题。';
      }
      return '不支持的操作，请使用 get/topics';
    },
  };
}
