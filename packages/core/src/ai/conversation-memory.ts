/**
 * ConversationMemory — 基于数据库的会话记忆（话题感知 + 链式摘要）
 *
 * 两张表分离存储：
 *
 *   ai_messages 表（逐条记录）：
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ session_id | role      | content        | round | time   │
 *   │ s1         | user      | 你好           | 1     | ...    │
 *   │ s1         | assistant | 你好呀！       | 1     | ...    │
 *   │ ...        | ...       | ...            | ...   | ...    │
 *   └──────────────────────────────────────────────────────────┘
 *
 *   ai_summaries 表（链式摘要）：
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ id | session_id | parent_id | from_round | to_round | summary     │
 *   │ 1  | s1         | null      | 1          | 7        | 用户讨论了… │
 *   │ 2  | s1         | 1         | 8          | 15       | 之前...又…  │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * 摘要触发规则：
 *   1. 检测到话题切换（当前消息与最近消息的关键词重合度低）
 *   2. 且上一个话题持续 ≥ minTopicRounds 轮
 *   → 异步生成摘要，覆盖上一话题的全部消息
 *
 * 上下文构建规则：
 *   1. 取最新 summary + 最近 slidingWindowSize 轮消息（滑动窗口）
 *   2. 检查连续性：summary.to_round === window第一条round - 1
 *      → 连续：[summary] + [window]
 *      → 不连续：丢弃 summary，仅用 [window]
 */

import { Logger } from '@zhin.js/logger';
import type { AIProvider, ChatMessage } from './types.js';

const logger = new Logger(null, 'ConvMemory');

// ============================================================================
// 数据库模型定义
// ============================================================================

/** ai_messages 表结构 */
export const AI_MESSAGE_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  role: { type: 'text' as const, nullable: false },
  content: { type: 'text' as const, nullable: false },
  round: { type: 'integer' as const, nullable: false },
  created_at: { type: 'integer' as const, default: 0 },
};

/** ai_summaries 表结构（链式） */
export const AI_SUMMARY_MODEL = {
  session_id: { type: 'text' as const, nullable: false },
  parent_id: { type: 'integer' as const, nullable: true },
  from_round: { type: 'integer' as const, nullable: false },
  to_round: { type: 'integer' as const, nullable: false },
  summary: { type: 'text' as const, nullable: false },
  created_at: { type: 'integer' as const, default: 0 },
};

// ============================================================================
// 类型
// ============================================================================

interface MessageRecord {
  id?: number;
  session_id: string;
  role: string;
  content: string;
  round: number;
  created_at: number;
}

interface SummaryRecord {
  id?: number;
  session_id: string;
  parent_id: number | null;
  from_round: number;
  to_round: number;
  summary: string;
  created_at: number;
}

/**
 * 数据库模型接口（与 RelatedModel 的链式查询 API 对齐）
 *
 * select(...fields) → Selection (thenable, 支持 .where().orderBy().limit())
 * create(data) → Promise<any>
 */
interface DbModel {
  select(...fields: string[]): any;  // 返回 Selection (thenable query builder)
  create(data: Record<string, any>): Promise<any>;
}

export interface ConversationMemoryConfig {
  /** 一个话题至少持续多少轮才触发摘要（默认 5） */
  minTopicRounds?: number;
  /** 滑动窗口大小：最近 N 轮消息（默认 5） */
  slidingWindowSize?: number;
  /** 话题切换检测阈值（0-1，值越低越敏感，默认 0.15） */
  topicChangeThreshold?: number;
}

const DEFAULT_CONFIG: Required<ConversationMemoryConfig> = {
  minTopicRounds: 5,
  slidingWindowSize: 5,
  topicChangeThreshold: 0.15,
};

// ============================================================================
// Store 接口
// ============================================================================

interface IStore {
  getMessages(sessionId: string): Promise<MessageRecord[]>;
  addMessage(record: MessageRecord): Promise<void>;
  getMaxRound(sessionId: string): Promise<number>;
  getMessagesAfterRound(sessionId: string, afterRound: number): Promise<MessageRecord[]>;
  getMessagesByRoundRange(sessionId: string, fromRound: number, toRound: number): Promise<MessageRecord[]>;
  searchMessages(sessionId: string, keyword: string): Promise<MessageRecord[]>;
  getLatestSummary(sessionId: string): Promise<SummaryRecord | null>;
  getSummaryById(sessionId: string, summaryId: number): Promise<SummaryRecord | null>;
  addSummary(record: Omit<SummaryRecord, 'id'>): Promise<SummaryRecord>;
  dispose(): void;
}

// ============================================================================
// 内存实现
// ============================================================================

class MemoryStore implements IStore {
  private messages: Map<string, MessageRecord[]> = new Map();
  private summaries: Map<string, SummaryRecord[]> = new Map();
  private nextSummaryId = 1;

  async getMessages(sessionId: string): Promise<MessageRecord[]> {
    return this.messages.get(sessionId) || [];
  }

  async addMessage(record: MessageRecord): Promise<void> {
    const list = this.messages.get(record.session_id) || [];
    list.push(record);
    this.messages.set(record.session_id, list);
  }

  async getMaxRound(sessionId: string): Promise<number> {
    const msgs = this.messages.get(sessionId) || [];
    if (msgs.length === 0) return 0;
    return Math.max(...msgs.map(m => m.round));
  }

  async getMessagesAfterRound(sessionId: string, afterRound: number): Promise<MessageRecord[]> {
    const msgs = this.messages.get(sessionId) || [];
    return msgs.filter(m => m.round > afterRound);
  }

  async getMessagesByRoundRange(sessionId: string, fromRound: number, toRound: number): Promise<MessageRecord[]> {
    const msgs = this.messages.get(sessionId) || [];
    return msgs.filter(m => m.round >= fromRound && m.round <= toRound);
  }

  async searchMessages(sessionId: string, keyword: string): Promise<MessageRecord[]> {
    const msgs = this.messages.get(sessionId) || [];
    const kw = keyword.toLowerCase();
    return msgs.filter(m => m.content.toLowerCase().includes(kw));
  }

  async getLatestSummary(sessionId: string): Promise<SummaryRecord | null> {
    const list = this.summaries.get(sessionId) || [];
    if (list.length === 0) return null;
    return list.reduce((a, b) => a.to_round > b.to_round ? a : b);
  }

  async getSummaryById(sessionId: string, summaryId: number): Promise<SummaryRecord | null> {
    const list = this.summaries.get(sessionId) || [];
    return list.find(s => s.id === summaryId) ?? null;
  }

  async addSummary(record: Omit<SummaryRecord, 'id'>): Promise<SummaryRecord> {
    const full: SummaryRecord = { ...record, id: this.nextSummaryId++ };
    const list = this.summaries.get(record.session_id) || [];
    list.push(full);
    this.summaries.set(record.session_id, list);
    return full;
  }

  dispose(): void {
    this.messages.clear();
    this.summaries.clear();
  }
}

// ============================================================================
// 数据库实现
// ============================================================================

class DatabaseStore implements IStore {
  constructor(private msgModel: DbModel, private sumModel: DbModel) {}

  async getMessages(sessionId: string): Promise<MessageRecord[]> {
    return (await this.msgModel.select().where({ session_id: sessionId })) as MessageRecord[];
  }

  async addMessage(record: MessageRecord): Promise<void> {
    await this.msgModel.create(record);
  }

  async getMaxRound(sessionId: string): Promise<number> {
    const msgs = await this.getMessages(sessionId);
    if (msgs.length === 0) return 0;
    return Math.max(...msgs.map(m => m.round));
  }

  async getMessagesAfterRound(sessionId: string, afterRound: number): Promise<MessageRecord[]> {
    const msgs = await this.getMessages(sessionId);
    return msgs.filter(m => m.round > afterRound);
  }

  async getMessagesByRoundRange(sessionId: string, fromRound: number, toRound: number): Promise<MessageRecord[]> {
    const msgs = await this.getMessages(sessionId);
    return msgs.filter(m => m.round >= fromRound && m.round <= toRound);
  }

  async searchMessages(sessionId: string, keyword: string): Promise<MessageRecord[]> {
    const msgs = await this.getMessages(sessionId);
    const kw = keyword.toLowerCase();
    return msgs.filter(m => m.content.toLowerCase().includes(kw));
  }

  async getLatestSummary(sessionId: string): Promise<SummaryRecord | null> {
    const records = (await this.sumModel.select().where({ session_id: sessionId })) as SummaryRecord[];
    if (records.length === 0) return null;
    return records.reduce((a, b) => a.to_round > b.to_round ? a : b);
  }

  async getSummaryById(sessionId: string, summaryId: number): Promise<SummaryRecord | null> {
    const records = (await this.sumModel.select().where({ session_id: sessionId })) as SummaryRecord[];
    return records.find(s => s.id === summaryId) ?? null;
  }

  async addSummary(record: Omit<SummaryRecord, 'id'>): Promise<SummaryRecord> {
    const created = await this.sumModel.create(record);
    return { ...record, id: created?.id ?? created?.lastID ?? 0 } as SummaryRecord;
  }

  dispose(): void {}
}

// ============================================================================
// 话题检测工具
// ============================================================================

/**
 * 提取文本中的关键词集合（中文按字/词，英文按空格分词）
 *
 * 简单但高效：不依赖分词库，用字符 bigram + 英文单词作为特征
 */
function extractTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fff\w]/g, ' ');

  // 中文字符 bigram
  const chars = cleaned.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < chars.length - 1; i++) {
    tokens.add(chars.slice(i, i + 2));
  }
  // 单个中文字也加入（短消息可能只有单字关键词）
  for (const ch of chars) {
    tokens.add(ch);
  }

  // 英文单词（≥2字符）
  const words = cleaned.match(/[a-z]{2,}/g);
  if (words) {
    for (const w of words) tokens.add(w);
  }

  return tokens;
}

/**
 * 计算两个 token 集合的 Jaccard 相似度
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ============================================================================
// ConversationMemory
// ============================================================================

/** 话题跟踪状态（per-session，仅内存） */
interface TopicState {
  /** 当前话题的起始轮次 */
  topicStartRound: number;
  /** 最近几轮用户消息的合并 token 集合（用于 Jaccard 快检） */
  recentTokens: Set<string>;
  /** 最近几轮用户消息原文（用于 LLM 话题判断，保留最近 3 条） */
  recentUserMessages: string[];
}

export class ConversationMemory {
  private store: IStore;
  private provider: AIProvider | null = null;
  private config: Required<ConversationMemoryConfig>;
  private summarizing: Set<string> = new Set();
  /** per-session 话题跟踪 */
  private topicStates: Map<string, TopicState> = new Map();
  /** per-session 轮次缓存（避免每次查数据库） */
  private roundCache: Map<string, number> = new Map();

  constructor(config?: ConversationMemoryConfig) {
    this.store = new MemoryStore();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── 依赖注入 ──

  setProvider(provider: AIProvider): void {
    this.provider = provider;
  }

  upgradeToDatabase(msgModel: DbModel, sumModel: DbModel): void {
    const old = this.store;
    this.store = new DatabaseStore(msgModel, sumModel);
    old.dispose();
    logger.debug('ConversationMemory: upgraded to database storage');
  }

  // ── 写入 ──

  /**
   * 保存一轮对话，并检测话题切换来触发摘要
   */
  async saveRound(
    sessionId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    // 优先用缓存，首次才查数据库
    const cached = this.roundCache.get(sessionId);
    let currentRound = cached != null ? cached + 1 : (await this.store.getMaxRound(sessionId)) + 1;
    // 防御性检查：确保 round 始终是有效正整数
    if (!Number.isFinite(currentRound) || currentRound < 1) {
      logger.warn(`[saveRound] round 异常 (${currentRound}), 重置为 1`);
      currentRound = 1;
    }
    this.roundCache.set(sessionId, currentRound);
    const ts = Date.now();

    await this.store.addMessage({
      session_id: sessionId,
      role: 'user',
      content: userContent,
      round: currentRound,
      created_at: ts,
    });
    await this.store.addMessage({
      session_id: sessionId,
      role: 'assistant',
      content: assistantContent,
      round: currentRound,
      created_at: ts,
    });

    // 话题切换检测 + 异步摘要
    this.handleTopicAndSummary(sessionId, userContent, currentRound);
  }

  // ── 话题检测 + 摘要触发 ──

  /**
   * 话题检测流程（全程异步，不阻塞对话）：
   *
   *   1. 短消息（token ≤ 3）→ 跳过检测，视为延续话题
   *   2. Jaccard 快检 → 高相似(≥ 0.5) → 肯定同话题，跳过 LLM
   *   3. Jaccard 不确定(< 0.5) → 调 LLM 裁决
   *   4. LLM 判定切换 + 旧话题 ≥ minTopicRounds → 触发摘要
   */
  private handleTopicAndSummary(
    sessionId: string,
    userContent: string,
    currentRound: number,
  ): void {
    let state = this.topicStates.get(sessionId);

    // 首次对话 → 初始化
    if (!state) {
      state = {
        topicStartRound: currentRound,
        recentTokens: extractTokens(userContent),
        recentUserMessages: [userContent],
      };
      this.topicStates.set(sessionId, state);
      return;
    }

    const currentTokens = extractTokens(userContent);

    // 短消息跳过检测
    if (currentTokens.size <= 3) {
      for (const t of currentTokens) state.recentTokens.add(t);
      state.recentUserMessages.push(userContent);
      if (state.recentUserMessages.length > 3) state.recentUserMessages.shift();
      return;
    }

    // Jaccard 快检
    const similarity = jaccardSimilarity(currentTokens, state.recentTokens);

    if (similarity >= 0.5) {
      // 高相似 → 肯定同话题，无需 LLM
      this.updateTopicState(state, currentTokens, userContent);
      return;
    }

    // 不确定 → 异步调 LLM 裁决
    logger.debug(`[话题检测] Jaccard=${similarity.toFixed(2)} < 0.5, 交由 LLM 判断`);

    const recentMsgs = [...state.recentUserMessages];
    const topicStart = state.topicStartRound;

    // 先乐观更新（假设同话题），LLM 判定后可能回滚
    this.updateTopicState(state, currentTokens, userContent);

    // 异步 LLM 判断
    this.detectTopicChangeByLLM(recentMsgs, userContent).then((isChange) => {
      if (!isChange) {
        logger.debug(`[话题检测] LLM 判定: 同话题`);
        return;
      }

      // LLM 确认话题切换
      const topicDuration = currentRound - topicStart;
      logger.debug(
        `[话题检测] LLM 判定: 切换! ` +
        `旧话题: 第${topicStart}-${currentRound - 1}轮 (${topicDuration}轮)`,
      );

      // 回滚话题状态 → 重置为新话题
      const currentState = this.topicStates.get(sessionId);
      if (currentState) {
        currentState.topicStartRound = currentRound;
        currentState.recentTokens = currentTokens;
        currentState.recentUserMessages = [userContent];
      }

      // 旧话题够长 → 生成摘要
      if (topicDuration >= this.config.minTopicRounds) {
        this.generateSummaryAsync(sessionId, topicStart, currentRound - 1);
      }
    }).catch((err) => {
      logger.warn('[话题检测] LLM 调用失败，保持当前话题', err);
    });
  }

  /** 更新话题状态（同话题情况） */
  private updateTopicState(state: TopicState, tokens: Set<string>, message: string): void {
    for (const t of tokens) state.recentTokens.add(t);
    if (state.recentTokens.size > 500) state.recentTokens = tokens;
    state.recentUserMessages.push(message);
    if (state.recentUserMessages.length > 3) state.recentUserMessages.shift();
  }

  /**
   * 调用 LLM 判断话题是否切换
   *
   * 输入: 最近几条用户消息 + 当前用户消息
   * 输出: true = 话题切换, false = 同话题
   */
  private async detectTopicChangeByLLM(
    recentMessages: string[],
    currentMessage: string,
  ): Promise<boolean> {
    if (!this.provider) return false;

    const recentText = recentMessages.map((m, i) => `${i + 1}. ${m}`).join('\n');
    const model = this.provider.models[0];

    const response = await this.provider.chat({
      model,
      messages: [
        {
          role: 'system',
          content: '你是一个话题分析助手。判断用户最新发送的消息相比之前的消息，是否切换到了一个全新的话题。只回答一个字：是 或 否。',
        },
        {
          role: 'user',
          content: `之前的消息：\n${recentText}\n\n最新消息：\n${currentMessage}`,
        },
      ],
      temperature: 0.1,
    });

    const raw = response.choices[0]?.message?.content;
    const content = (typeof raw === 'string' ? raw : '').trim();
    // 解析回答：包含"是"→ 切换，包含"否"或其他 → 未切换
    return content.includes('是') && !content.includes('否');
  }

  /**
   * 异步生成链式摘要（不阻塞对话）
   */
  private generateSummaryAsync(
    sessionId: string,
    fromRound: number,
    toRound: number,
  ): void {
    if (!this.provider) return;
    if (this.summarizing.has(sessionId)) return;

    this.summarizing.add(sessionId);

    this.store.getLatestSummary(sessionId).then(async (parentSummary) => {
      try {
        const messages = await this.store.getMessagesByRoundRange(sessionId, fromRound, toRound);
        if (messages.length === 0) {
          this.summarizing.delete(sessionId);
          return;
        }

        logger.debug(
          `[摘要] 开始: session=${sessionId}, 轮次 ${fromRound}-${toRound}, ` +
          `parent=${parentSummary?.id ?? 'null'}, ${messages.length}条消息`,
        );

        const summaryText = await this.callLLMSummarize(
          parentSummary?.summary ?? null,
          messages,
        );

        // 质量兜底：字数异常的摘要丢弃
        if (summaryText && summaryText.length >= 20 && summaryText.length <= 1000) {
          const created = await this.store.addSummary({
            session_id: sessionId,
            parent_id: parentSummary?.id ?? null,
            from_round: fromRound,
            to_round: toRound,
            summary: summaryText,
            created_at: Date.now(),
          });
          logger.info(
            `[摘要] 完成: id=${created.id}, session=${sessionId}, ` +
            `轮次 ${fromRound}-${toRound}, parent=${parentSummary?.id ?? 'null'}, ` +
            `${summaryText.length}字`,
          );
        } else {
          logger.warn(
            `[摘要] 质量异常，丢弃: session=${sessionId}, ` +
            `长度=${summaryText?.length ?? 0}`,
          );
        }
      } catch (err) {
        logger.warn(`[摘要] 失败: session=${sessionId}`, err);
      } finally {
        this.summarizing.delete(sessionId);
      }
    });
  }

  // ── 读取（构建上下文） ──

  /**
   * 构建 LLM 上下文消息列表
   *
   * 规则：
   *   1. 取滑动窗口（最近 slidingWindowSize 轮）
   *   2. 取最新 summary
   *   3. 检查连续性：summary.to_round === window第一轮 - 1
   *      → 连续：[summary] + [window 消息]
   *      → 不连续：仅 [window 消息]
   */
  async buildContext(sessionId: string): Promise<ChatMessage[]> {
    const currentRound = this.roundCache.get(sessionId) ?? await this.store.getMaxRound(sessionId);
    if (currentRound === 0) return [];

    // 1. 滑动窗口
    const windowStart = Math.max(1, currentRound - this.config.slidingWindowSize + 1);
    const windowMessages = await this.store.getMessagesByRoundRange(sessionId, windowStart, currentRound);
    windowMessages.sort((a, b) => a.round - b.round || a.created_at - b.created_at);

    if (windowMessages.length === 0) return [];

    const firstWindowRound = windowMessages[0].round;

    // 2. 取最新 summary
    const latest = await this.store.getLatestSummary(sessionId);

    const result: ChatMessage[] = [];

    // 3. 连续性校验
    //    连续: summary.to_round >= firstWindowRound - 1
    //      → 紧挨（to_round === first-1）或重叠（to_round >= first）都算连续
    //    不连续: summary.to_round < firstWindowRound - 1
    //      → 中间有间隔，summary 与当前话题无关，丢弃
    if (latest && latest.to_round >= firstWindowRound - 1) {
      result.push({
        role: 'system',
        content: `[对话记忆] 之前的对话摘要（覆盖第${latest.from_round}-${latest.to_round}轮）：\n${latest.summary}`,
      });

      // 重叠时去重：只注入 summary 未覆盖的窗口消息
      const dedupStart = latest.to_round + 1;
      const dedupMessages = windowMessages.filter(m => m.round >= dedupStart);
      for (const msg of dedupMessages) {
        result.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
      logger.debug(
        `[上下文] summary(${latest.from_round}-${latest.to_round}) + ` +
        `window(${dedupStart}-${currentRound}), 去重后${dedupMessages.length}条`,
      );
    } else {
      if (latest) {
        logger.debug(
          `[上下文] summary 不连续 (to_round=${latest.to_round}, window_start=${firstWindowRound}), 仅用窗口`,
        );
      }
      // 无 summary 或不连续 → 仅窗口
      for (const msg of windowMessages) {
        result.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
      }
    }

    return result;
  }

  // ── LLM 摘要 ──

  private async callLLMSummarize(
    parentSummary: string | null,
    messages: MessageRecord[],
  ): Promise<string | null> {
    if (!this.provider || messages.length === 0) return null;

    const transcript = messages
      .sort((a, b) => a.round - b.round || a.created_at - b.created_at)
      .map(m => {
        const role = m.role === 'user' ? '用户' : '助手';
        return `${role}: ${m.content}`;
      })
      .join('\n');

    const maxChars = 3000;
    const trimmedTranscript = transcript.length > maxChars
      ? '...\n' + transcript.slice(-maxChars)
      : transcript;

    let userContent: string;
    if (parentSummary) {
      userContent =
        `## 之前的对话摘要\n${parentSummary}\n\n` +
        `## 最近的对话记录\n${trimmedTranscript}`;
    } else {
      userContent = trimmedTranscript;
    }

    const model = this.provider.models[0];
    const response = await this.provider.chat({
      model,
      messages: [
        {
          role: 'system',
          content: parentSummary
            ? '你是一个对话摘要助手。请将「之前的摘要」和「最近的对话记录」合并为一段新的综合摘要（150-300字）。保留关键信息、用户偏好和重要结论，让新摘要完整覆盖所有历史。只输出摘要内容，不要添加任何前缀。'
            : '你是一个对话摘要助手。请将以下对话压缩为一段简洁的中文摘要（100-200字），保留关键信息、用户偏好和重要结论。只输出摘要内容，不要添加任何前缀。',
        },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : null;
  }

  // ── 查询 API（供 AI 工具调用） ──

  async searchMessages(
    sessionId: string,
    keyword: string,
    limit = 20,
  ): Promise<{ round: number; role: string; content: string; time: number }[]> {
    const results = await this.store.searchMessages(sessionId, keyword);
    return results
      .sort((a, b) => b.round - a.round || b.created_at - a.created_at)
      .slice(0, limit)
      .map(m => ({ round: m.round, role: m.role, content: m.content, time: m.created_at }));
  }

  async getMessagesByRound(
    sessionId: string,
    fromRound: number,
    toRound: number,
  ): Promise<{ round: number; role: string; content: string; time: number }[]> {
    const results = await this.store.getMessagesByRoundRange(sessionId, fromRound, toRound);
    return results
      .sort((a, b) => a.round - b.round || a.created_at - b.created_at)
      .map(m => ({ round: m.round, role: m.role, content: m.content, time: m.created_at }));
  }

  async getCurrentRound(sessionId: string): Promise<number> {
    return this.roundCache.get(sessionId) ?? this.store.getMaxRound(sessionId);
  }

  async traceByKeyword(
    sessionId: string,
    keyword: string,
    limit = 30,
  ): Promise<{
    summary: { id: number; fromRound: number; toRound: number; summary: string } | null;
    messages: { round: number; role: string; content: string; time: number }[];
  }> {
    const kw = keyword.toLowerCase();

    let current = await this.store.getLatestSummary(sessionId);
    let matchedSummary: SummaryRecord | null = null;

    while (current) {
      if (current.summary.toLowerCase().includes(kw)) {
        matchedSummary = current;
        break;
      }
      if (current.parent_id != null) {
        current = await this.store.getSummaryById(sessionId, current.parent_id);
      } else {
        break;
      }
    }

    if (matchedSummary) {
      const messages = await this.store.getMessagesByRoundRange(
        sessionId, matchedSummary.from_round, matchedSummary.to_round,
      );
      return {
        summary: {
          id: matchedSummary.id!,
          fromRound: matchedSummary.from_round,
          toRound: matchedSummary.to_round,
          summary: matchedSummary.summary,
        },
        messages: messages
          .sort((a, b) => a.round - b.round || a.created_at - b.created_at)
          .slice(0, limit)
          .map(m => ({ round: m.round, role: m.role, content: m.content, time: m.created_at })),
      };
    }

    const directResults = await this.store.searchMessages(sessionId, keyword);
    return {
      summary: null,
      messages: directResults
        .sort((a, b) => b.round - a.round)
        .slice(0, limit)
        .map(m => ({ round: m.round, role: m.role, content: m.content, time: m.created_at })),
    };
  }

  // ── 生命周期 ──

  dispose(): void {
    this.store.dispose();
    this.summarizing.clear();
    this.topicStates.clear();
    this.roundCache.clear();
  }
}
