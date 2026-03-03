/**
 * ZhinAgent 内置上下文工具工厂
 *
 * 这些工具依赖运行时上下文（sessionId / userId / context），
 * 由 ZhinAgent.process() 按需创建并注入到工具列表中。
 */

import type { ToolContext } from '@zhin.js/core';
import type { AgentTool } from '@zhin.js/core';
import type { ConversationMemory } from '../conversation-memory.js';
import type { UserProfileStore } from '../user-profile.js';
import type { FollowUpManager } from '../follow-up.js';
import type { SubagentManager, SubagentOrigin } from '../subagent.js';

export function createChatHistoryTool(sessionId: string, memory: ConversationMemory): AgentTool {
  return {
    name: 'chat_history',
    description: '搜索与用户的历史聊天记录。可以按关键词搜索，也可以按对话轮次范围查询。当用户问到"之前聊过什么""我们讨论过什么"等回忆类问题时使用。',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '搜索关键词（模糊匹配消息内容和摘要）。留空则返回最近几轮记录',
        },
        from_round: {
          type: 'number',
          description: '起始轮次（与 to_round 配合使用，精确查询某段对话）',
        },
        to_round: {
          type: 'number',
          description: '结束轮次',
        },
      },
      required: ['keyword'],
    },
    tags: ['memory', 'history', '聊天记录', '回忆', '之前'],
    keywords: ['之前', '历史', '聊过', '讨论过', '记得', '上次', '以前', '回忆'],
    async execute(args: Record<string, any>) {
      const { keyword, from_round, to_round } = args;
      const currentRound = await memory.getCurrentRound(sessionId);

      if (keyword) {
        const result = await memory.traceByKeyword(sessionId, keyword);
        const msgs = result.messages.map(m => {
          const role = m.role === 'user' ? '用户' : '助手';
          const time = new Date(m.time).toLocaleString('zh-CN');
          return `[第${m.round}轮 ${time}] ${role}: ${m.content}`;
        }).join('\n');

        let output = `当前是第 ${currentRound} 轮对话。\n\n`;
        if (result.summary) {
          output += `📋 找到相关摘要（覆盖第${result.summary.fromRound}-${result.summary.toRound}轮）：\n${result.summary.summary}\n\n`;
        }
        output += msgs ? `💬 相关聊天记录：\n${msgs}` : '未找到包含该关键词的聊天记录。';
        return output;
      }

      if (from_round != null && to_round != null) {
        const messages = await memory.getMessagesByRound(sessionId, from_round, to_round);
        if (messages.length === 0) {
          return `第 ${from_round}-${to_round} 轮没有聊天记录。当前是第 ${currentRound} 轮。`;
        }
        const msgs = messages.map(m => {
          const role = m.role === 'user' ? '用户' : '助手';
          const time = new Date(m.time).toLocaleString('zh-CN');
          return `[第${m.round}轮 ${time}] ${role}: ${m.content}`;
        }).join('\n');
        return `第 ${from_round}-${to_round} 轮聊天记录（当前第 ${currentRound} 轮）：\n${msgs}`;
      }

      const messages = await memory.getMessagesByRound(
        sessionId,
        Math.max(1, currentRound - 4),
        currentRound,
      );
      if (messages.length === 0) {
        return '暂无聊天记录。';
      }
      const msgs = messages.map(m => {
        const role = m.role === 'user' ? '用户' : '助手';
        return `[第${m.round}轮] ${role}: ${m.content}`;
      }).join('\n');
      return `最近的聊天记录（当前第 ${currentRound} 轮）：\n${msgs}`;
    },
  };
}

export function createUserProfileTool(userId: string, profiles: UserProfileStore): AgentTool {
  return {
    name: 'user_profile',
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
          description: '偏好值（仅 set 操作需要）',
        },
      },
      required: ['action'],
    },
    tags: ['profile', '偏好', '用户', '个性化', '记住'],
    keywords: ['我叫', '我的名字', '记住我', '我喜欢', '我偏好', '我习惯', '叫我', '我是'],
    async execute(args: Record<string, any>) {
      const { action, key, value } = args;

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

export function createScheduleFollowUpTool(
  sessionId: string,
  context: ToolContext,
  followUps: FollowUpManager,
): AgentTool {
  const platform = context.platform || '';
  const botId = context.botId || '';
  const senderId = context.senderId || '';
  const sceneId = context.sceneId || '';
  const sceneType = context.message?.$channel?.type || 'private';

  return {
    name: 'schedule_followup',
    description: '安排或取消定时跟进提醒。创建新提醒会自动取消之前的提醒。提醒持久保存，重启不丢失。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型: create（创建提醒，默认）或 cancel（取消当前会话所有提醒）',
          enum: ['create', 'cancel'],
        },
        delay_minutes: {
          type: 'number',
          description: '延迟时间，单位是分钟。注意：3 就是 3 分钟，不是 3 小时。举例: 3 = 3分钟后, 60 = 1小时后, 1440 = 1天后',
        },
        message: {
          type: 'string',
          description: '提醒消息内容',
        },
      },
      required: ['action'],
    },
    tags: ['reminder', '提醒', '跟进', '定时'],
    keywords: ['提醒', '提醒我', '过一会', '过一小时', '明天', '跟进', '别忘了', '记得提醒', '取消提醒'],
    async execute(args: Record<string, any>) {
      const { action = 'create', delay_minutes, message: msg } = args;

      if (action === 'cancel') {
        const count = await followUps.cancelBySession(sessionId);
        return count > 0
          ? `✅ 已取消 ${count} 个待执行的提醒`
          : '当前没有待执行的提醒';
      }

      if (!delay_minutes || delay_minutes <= 0) return '延迟时间必须大于 0 分钟';
      if (!msg) return '请提供提醒内容';

      return followUps.schedule({
        sessionId,
        platform,
        botId,
        senderId,
        sceneId,
        sceneType,
        message: msg,
        delayMinutes: delay_minutes,
      });
    },
  };
}

export function createSpawnTaskTool(
  context: ToolContext,
  manager: SubagentManager,
): AgentTool {
  const platform = context.platform || '';
  const botId = context.botId || '';
  const senderId = context.senderId || '';
  const sceneId = context.sceneId || '';
  const sceneType = context.message?.$channel?.type || 'private';

  return {
    name: 'spawn_task',
    description: '将复杂或耗时的任务交给后台子 agent 异步处理。子 agent 拥有文件读写、Shell、网络搜索等能力，完成后会自动通知用户。适用于需要多步操作的文件处理、代码分析、数据收集等任务。',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '要交给子 agent 完成的任务描述（尽量详细，包含目标、范围、期望输出）',
        },
        label: {
          type: 'string',
          description: '任务的简短标签（用于显示，可选）',
        },
      },
      required: ['task'],
    },
    tags: ['agent', 'async', 'task', '后台', '子任务'],
    keywords: ['后台', '异步', '子任务', 'spawn', 'background', '并行', '独立处理'],
    async execute(args: Record<string, any>) {
      const { task, label } = args;
      if (!task) return '请提供任务描述';

      const origin: SubagentOrigin = {
        platform,
        botId,
        sceneId,
        senderId,
        sceneType,
      };

      return manager.spawn({ task, label, origin });
    },
  };
}
