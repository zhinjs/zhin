/**
 * @zhin.js/ai - Context Manager
 * 上下文管理器，负责消息记录、历史读取和智能总结
 * 
 * 特性：
 * - 所有平台消息自动落表
 * - 按场景（scene_id）读取历史消息
 * - 智能总结，保持上下文简洁
 * - 支持多平台、多场景
 */

import { Logger } from '@zhin.js/logger';
import type { ChatMessage, AIProvider } from './types.js';

const logger = new Logger(null, 'ContextManager');

// ============================================================================
// 数据库模型定义
// ============================================================================

/**
 * 聊天消息记录模型定义
 */
export const CHAT_MESSAGE_MODEL = {
  platform: { type: 'text' as const, nullable: false },      // 平台：icqq, kook, discord 等
  scene_id: { type: 'text' as const, nullable: false },      // 场景ID：群号/频道ID/用户ID
  scene_type: { type: 'text' as const, nullable: false },    // 场景类型：group, private, channel
  scene_name: { type: 'text' as const, default: '' },        // 场景名称
  sender_id: { type: 'text' as const, nullable: false },     // 发送者ID
  sender_name: { type: 'text' as const, default: '' },       // 发送者名称
  message: { type: 'text' as const, nullable: false },       // 消息内容
  time: { type: 'integer' as const, nullable: false },       // 时间戳（毫秒）
};

/**
 * 上下文总结模型定义
 */
export const CONTEXT_SUMMARY_MODEL = {
  scene_id: { type: 'text' as const, nullable: false },      // 场景ID
  summary: { type: 'text' as const, nullable: false },       // 总结内容
  message_count: { type: 'integer' as const, default: 0 },   // 包含的消息数量
  start_time: { type: 'integer' as const, default: 0 },      // 总结的起始时间
  end_time: { type: 'integer' as const, default: 0 },        // 总结的结束时间
  created_at: { type: 'integer' as const, default: 0 },      // 创建时间
};

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 消息记录
 */
export interface MessageRecord {
  id?: number;
  platform: string;
  scene_id: string;
  scene_type: 'group' | 'private' | 'channel' | string;
  scene_name: string;
  sender_id: string;
  sender_name: string;
  message: string;
  time: number;
}

/**
 * 上下文总结记录
 */
export interface SummaryRecord {
  id?: number;
  scene_id: string;
  summary: string;
  message_count: number;
  start_time: number;
  end_time: number;
  created_at: number;
}

/**
 * 上下文配置
 */
export interface ContextConfig {
  /** 是否启用上下文管理（默认 true） */
  enabled?: boolean;
  /** 读取的最近消息数量（默认 100） */
  maxRecentMessages?: number;
  /** 触发总结的消息数量阈值（默认 50） */
  summaryThreshold?: number;
  /** 总结后保留的消息数量（默认 10） */
  keepAfterSummary?: number;
  /** 上下文最大 token 估算（默认 4000） */
  maxContextTokens?: number;
  /** 总结提示词 */
  summaryPrompt?: string;
}

/**
 * 场景上下文
 */
export interface SceneContext {
  sceneId: string;
  sceneType: string;
  sceneName: string;
  platform: string;
  /** 历史总结 */
  summaries: string[];
  /** 最近消息 */
  recentMessages: MessageRecord[];
  /** 格式化的聊天消息 */
  chatMessages: ChatMessage[];
}

// ============================================================================
// 上下文管理器
// ============================================================================

/**
 * 上下文管理器
 * 负责消息记录、历史读取和智能总结
 */
export class ContextManager {
  private messageModel: any;
  private summaryModel: any;
  private config: Required<ContextConfig>;
  private aiProvider?: AIProvider;

  constructor(
    messageModel: any,
    summaryModel: any,
    config: ContextConfig = {}
  ) {
    this.messageModel = messageModel;
    this.summaryModel = summaryModel;
    this.config = {
      enabled: config.enabled ?? true,
      maxRecentMessages: config.maxRecentMessages ?? 100,
      summaryThreshold: config.summaryThreshold ?? 50,
      keepAfterSummary: config.keepAfterSummary ?? 10,
      maxContextTokens: config.maxContextTokens ?? 4000,
      summaryPrompt: config.summaryPrompt ?? this.getDefaultSummaryPrompt(),
    };
  }

  /**
   * 设置 AI 提供商（用于自动总结）
   */
  setAIProvider(provider: AIProvider): void {
    this.aiProvider = provider;
  }

  /**
   * 记录消息
   */
  async recordMessage(record: Omit<MessageRecord, 'id'>): Promise<void> {
    try {
      await this.messageModel.create(record);
    } catch (error) {
      logger.debug('记录消息失败:', error);
    }
  }

  /**
   * 获取场景的最近消息
   */
  async getRecentMessages(
    sceneId: string,
    limit: number = this.config.maxRecentMessages
  ): Promise<MessageRecord[]> {
    try {
      // 查询最近的消息，按时间倒序
      const messages = await this.messageModel
        .select()
        .where({ scene_id: sceneId })
        .orderBy('time', 'DESC')
        .limit(limit);
      // 反转为时间正序
      return (messages as MessageRecord[]).reverse();
    } catch (error) {
      logger.debug('获取最近消息失败:', error);
      return [];
    }
  }

  /**
   * 获取场景的总结历史
   */
  async getSummaries(sceneId: string): Promise<SummaryRecord[]> {
    try {
      const summaries = await this.summaryModel
        .select()
        .where({ scene_id: sceneId })
        .orderBy('created_at', 'ASC');
      return summaries as SummaryRecord[];
    } catch (error) {
      logger.debug('获取总结失败:', error);
      return [];
    }
  }

  /**
   * 构建场景上下文
   * 用于 AI 对话，包含历史总结和最近消息
   */
  async buildContext(sceneId: string, platform: string): Promise<SceneContext> {
    // 获取最近消息
    const recentMessages = await this.getRecentMessages(sceneId);
    
    // 获取历史总结
    const summaries = await this.getSummaries(sceneId);
    
    // 获取场景信息
    const sceneInfo = recentMessages.length > 0
      ? { sceneType: recentMessages[0].scene_type, sceneName: recentMessages[0].scene_name }
      : { sceneType: 'unknown', sceneName: '' };

    // 构建聊天消息格式
    const chatMessages = this.formatToChatMessages(
      summaries.map(s => s.summary),
      recentMessages
    );

    return {
      sceneId,
      sceneType: sceneInfo.sceneType,
      sceneName: sceneInfo.sceneName,
      platform,
      summaries: summaries.map(s => s.summary),
      recentMessages,
      chatMessages,
    };
  }

  /**
   * 格式化为 ChatMessage 格式
   */
  formatToChatMessages(
    summaries: string[],
    messages: MessageRecord[]
  ): ChatMessage[] {
    const chatMessages: ChatMessage[] = [];

    // 添加历史总结作为系统上下文
    if (summaries.length > 0) {
      chatMessages.push({
        role: 'system',
        content: `以下是之前对话的总结：\n\n${summaries.join('\n\n---\n\n')}\n\n请基于这些背景信息继续对话。`,
      });
    }

    // 添加最近消息
    for (const msg of messages) {
      // 判断是否是机器人消息（通常 sender_id 包含 bot 标识）
      const isBot = msg.sender_id.includes('bot') || msg.sender_name.toLowerCase().includes('bot');
      
      chatMessages.push({
        role: isBot ? 'assistant' : 'user',
        content: `[${msg.sender_name}]: ${msg.message}`,
        name: msg.sender_id,
      });
    }

    return chatMessages;
  }

  /**
   * 估算 token 数量（粗略估算）
   */
  estimateTokens(text: string): number {
    // 中文约 1 字 = 2 tokens，英文约 4 字符 = 1 token
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2 + otherChars / 4);
  }

  /**
   * 检查是否需要总结
   */
  async shouldSummarize(sceneId: string): Promise<boolean> {
    const messages = await this.getRecentMessages(sceneId, this.config.summaryThreshold + 10);
    
    if (messages.length < this.config.summaryThreshold) {
      return false;
    }

    // 估算 token 数量
    const totalText = messages.map(m => m.message).join('\n');
    const estimatedTokens = this.estimateTokens(totalText);

    return estimatedTokens > this.config.maxContextTokens;
  }

  /**
   * 执行总结
   */
  async summarize(sceneId: string): Promise<string | null> {
    if (!this.aiProvider) {
      logger.warn('未设置 AI provider，无法总结');
      return null;
    }

    const messages = await this.getRecentMessages(sceneId, this.config.summaryThreshold);
    
    if (messages.length < this.config.keepAfterSummary) {
      return null;
    }

    // 需要总结的消息（排除最近的几条）
    const toSummarize = messages.slice(0, -this.config.keepAfterSummary);
    
    if (toSummarize.length === 0) {
      return null;
    }

    // 格式化消息用于总结
    const conversationText = toSummarize
      .map(m => `[${m.sender_name}] (${new Date(m.time).toLocaleString()}): ${m.message}`)
      .join('\n');

    try {
      // 调用 AI 进行总结
      const response = await this.aiProvider.chat({
        model: this.aiProvider.models[0],
        messages: [
          { role: 'system', content: this.config.summaryPrompt },
          { role: 'user', content: conversationText },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const summary = response.choices[0]?.message?.content;
      if (typeof summary !== 'string' || !summary.trim()) {
        return null;
      }

      // 保存总结
      await this.saveSummary({
        scene_id: sceneId,
        summary: summary.trim(),
        message_count: toSummarize.length,
        start_time: toSummarize[0].time,
        end_time: toSummarize[toSummarize.length - 1].time,
        created_at: Date.now(),
      });

      // 删除已总结的消息（可选，保持数据库精简）
      // await this.deleteMessages(sceneId, toSummarize.map(m => m.id!));

      return summary;
    } catch (error) {
      logger.error('总结失败:', error);
      return null;
    }
  }

  /**
   * 保存总结
   */
  private async saveSummary(record: Omit<SummaryRecord, 'id'>): Promise<void> {
    try {
      await this.summaryModel.create(record);
    } catch (error) {
      logger.error('保存总结失败:', error);
    }
  }

  /**
   * 自动检查并总结（在每次对话后调用）
   */
  async autoSummarizeIfNeeded(sceneId: string): Promise<void> {
    const needSummary = await this.shouldSummarize(sceneId);
    if (needSummary) {
      logger.debug(`总结场景 ${sceneId}...`);
      await this.summarize(sceneId);
    }
  }

  /**
   * 获取场景统计信息
   */
  async getSceneStats(sceneId: string): Promise<{
    messageCount: number;
    summaryCount: number;
    firstMessageTime?: number;
    lastMessageTime?: number;
  }> {
    const messages = await this.getRecentMessages(sceneId, 1000);
    const summaries = await this.getSummaries(sceneId);

    return {
      messageCount: messages.length,
      summaryCount: summaries.length,
      firstMessageTime: messages.length > 0 ? messages[0].time : undefined,
      lastMessageTime: messages.length > 0 ? messages[messages.length - 1].time : undefined,
    };
  }

  /**
   * 清理过期消息
   */
  async cleanupOldMessages(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - maxAge;
    try {
      // 这里假设数据库支持条件删除
      // 实际实现可能需要根据数据库适配器调整
      const result = await this.messageModel.delete({ time: { $lt: cutoff } });
      return typeof result === 'number' ? result : 0;
    } catch (error) {
      logger.debug('清理旧消息失败:', error);
      return 0;
    }
  }

  /**
   * 默认总结提示词
   */
  private getDefaultSummaryPrompt(): string {
    return `你是一个对话总结助手。请将以下对话内容总结为简洁的要点，保留关键信息、人物关系和重要事件。

要求：
1. 使用第三人称描述
2. 保留重要的人名、事件、决定
3. 忽略日常寒暄和无意义的对话
4. 总结应该简洁，不超过 200 字
5. 如果对话中有明确的结论或决定，务必保留

请直接输出总结内容，不要添加额外的标题或格式。`;
  }
}

/**
 * 创建上下文管理器
 */
export function createContextManager(
  messageModel: any,
  summaryModel: any,
  config?: ContextConfig
): ContextManager {
  return new ContextManager(messageModel, summaryModel, config);
}
