/**
 * @zhin.js/ai - AI Service for Zhin.js
 * 
 * 多模型 AI 服务插件，支持：
 * - 多模型提供商（OpenAI、Claude、DeepSeek、Ollama 等）
 * - 工具调用（Function Calling）
 * - 流式输出
 * - 会话管理
 * - Agent 能力
 * - 独立的 AI 触发中间件（@机器人、前缀触发、私聊直接对话）
 */

import { 
  usePlugin, 
  Logger,
  // Tool Service 从 core 导入
  createToolService,
  ZhinTool,
  // AI Trigger 工具函数从 core 导入
  shouldTriggerAI,
  inferSenderPermissions,
  parseRichMediaContent,
  extractTextContent,
  mergeAITriggerConfig,
  type Message, 
  type Plugin, 
  type Tool,
  type ToolContext,
  type AITriggerConfig,
} from '@zhin.js/core';

const aiLogger = new Logger(null, 'AI');
import type {
  AIProvider,
  AIConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  AgentTool,
} from './types.js';
import {
  OpenAIProvider,
  DeepSeekProvider,
  MoonshotProvider,
  ZhipuProvider,
  AnthropicProvider,
  OllamaProvider,
} from './providers/index.js';
import { 
  SessionManager, 
  createMemorySessionManager, 
  createDatabaseSessionManager,
  AI_SESSION_MODEL,
  type ISessionManager 
} from './session.js';
import { Agent, createAgent } from './agent.js';
import { getBuiltinTools, getAllBuiltinTools } from './tools.js';

// ============================================================================
// 富媒体格式说明
// ============================================================================

/**
 * 支持的富媒体消息格式说明
 * AI 可以使用这些 XML-like 标签在回复中嵌入多媒体内容
 */
const RICH_MEDIA_GUIDE = `

## 富媒体输出格式

你可以在回复中使用以下 XML 标签输出富媒体内容：

1. **图片** - 展示图片
   \`<image url="图片URL"/>\`
   示例：<image url="https://example.com/cat.jpg"/>

2. **视频** - 展示视频
   \`<video url="视频URL"/>\`
   示例：<video url="https://example.com/video.mp4"/>

3. **音频** - 播放音频
   \`<audio url="音频URL"/>\`
   示例：<audio url="https://example.com/song.mp3"/>

4. **@用户** - 提及某人
   \`<at user_id="用户ID"/>\`
   示例：<at user_id="123456"/>

5. **表情** - 发送表情符号
   \`<face id="表情ID"/>\`
   示例：<face id="178"/>

注意事项：
- 富媒体标签可以与普通文本混合使用
- URL 必须是有效的、可访问的网络地址
- 图片建议使用 jpg/png/gif/webp 格式
- 适当使用图片和表情可以让回复更生动
`;
import {
  ContextManager,
  createContextManager,
  CHAT_MESSAGE_MODEL,
  CONTEXT_SUMMARY_MODEL,
  type MessageRecord,
  type ContextConfig,
} from './context-manager.js';

// ============================================================================
// 类型扩展
// ============================================================================

declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      ai: AIService;
    }
  }
}

// ============================================================================
// AI Service 类
// ============================================================================

/**
 * AI 服务
 * 统一管理多个模型提供商，提供会话和 Agent 能力
 */
export class AIService {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProvider: string;
  public sessions: SessionManager;
  public contextManager?: ContextManager;
  private builtinTools: AgentTool[];
  private sessionConfig: { maxHistory?: number; expireMs?: number };
  private contextConfig: ContextConfig;
  private triggerConfig: AITriggerConfig;
  private plugin?: Plugin;
  /** 额外注册的自定义工具 */
  private customTools: Map<string, AgentTool> = new Map();

  constructor(config: AIConfig = {}) {
    this.defaultProvider = config.defaultProvider || 'openai';
    this.sessionConfig = config.sessions || {};
    this.contextConfig = config.context || {};
    this.triggerConfig = config.trigger || {};
    // 先用内存会话管理器，后续通过 setSessionManager 切换到数据库
    this.sessions = createMemorySessionManager(this.sessionConfig);
    // 将 ZhinTool 转换为 AgentTool 格式（通过 convertToolToAgentTool 保留元数据）
    this.builtinTools = getBuiltinTools().map(tool => this.convertToolToAgentTool(tool.toTool()));

    // 初始化提供商
    if (config.providers?.openai?.apiKey) {
      this.registerProvider(new OpenAIProvider(config.providers.openai));
    }

    if (config.providers?.anthropic?.apiKey) {
      this.registerProvider(new AnthropicProvider(config.providers.anthropic));
    }

    if (config.providers?.deepseek?.apiKey) {
      this.registerProvider(new DeepSeekProvider(config.providers.deepseek));
    }

    if (config.providers?.moonshot?.apiKey) {
      this.registerProvider(new MoonshotProvider(config.providers.moonshot));
    }

    if (config.providers?.zhipu?.apiKey) {
      this.registerProvider(new ZhipuProvider(config.providers.zhipu));
    }

    if (config.providers?.ollama) {
      this.registerProvider(new OllamaProvider(config.providers.ollama));
    }
  }

  // ============================================================================
  // AI 处理核心方法
  // ============================================================================

  /**
   * 检查 AI 服务是否就绪
   */
  isReady(): boolean {
    return this.providers.size > 0;
  }

  /** 预执行超时 (ms) */
  private static readonly PRE_EXEC_TIMEOUT = 10_000;

  /**
   * 处理 AI 请求
   * 这是 AI 触发中间件调用的主入口
   *
   * 优化后的处理架构——根据工具类型自动选择最快路径：
   *
   * ┌─ 快速路径（1 次 AI 往返）──────────────────────────────┐
   * │  命中的全是无参数工具 → 程序直接预执行 → 结果注入 prompt │
   * │  AI 一次生成回答                                        │
   * └────────────────────────────────────────────────────────┘
   *
   * ┌─ Agent 路径（2 次 AI 往返）────────────────────────────┐
   * │  存在需要参数的工具 → Agent 调用工具 → 同一对话生成回答  │
   * │  提示词保证模型在最后一轮**必须**输出完整文本            │
   * └────────────────────────────────────────────────────────┘
   */
  async process(
    content: string,
    context: ToolContext,
    tools: Tool[]
  ): Promise<string | AsyncIterable<string>> {
    const { platform, senderId, sceneId } = context;

    // 生成会话 ID
    const sessionId = SessionManager.generateId(platform || '', senderId || '', sceneId);

    // 收集所有可用工具
    const allTools = this.collectAllToolsWithExternal(tools);

    // 基础系统提示
    const baseSystemPrompt = `你是一个友好的中文 AI 助手，请始终使用中文回复。
${RICH_MEDIA_GUIDE}`;

    // 如果没有工具，直接对话
    if (allTools.length === 0) {
      return this.finishAndSave(sessionId, content, baseSystemPrompt, sceneId);
    }

    aiLogger.debug(`处理开始，可用工具: ${allTools.length}`);

    // ========== 1. 程序化工具过滤 ==========
    const callerPermissionLevel = context.senderPermissionLevel
      ? (AIService.PERM_MAP[context.senderPermissionLevel] ?? 0)
      : (context.isOwner ? 4 : context.isBotAdmin ? 3 : context.isGroupOwner ? 2 : context.isGroupAdmin ? 1 : 0);

    const relevantTools = Agent.filterTools(content, allTools, {
      callerPermissionLevel,
      maxTools: 8,
      minScore: 0.1,
    });
    aiLogger.debug(`程序化过滤: ${allTools.length} -> ${relevantTools.length} (${relevantTools.map(t => t.name).join(', ')})`);

    if (relevantTools.length === 0) {
      return this.finishAndSave(sessionId, content, baseSystemPrompt, sceneId);
    }

    // ========== 2. 拆分工具：无参数 vs 需要参数 ==========
    const noParamTools: AgentTool[] = [];
    const paramTools: AgentTool[] = [];
    for (const tool of relevantTools) {
      const required = tool.parameters?.required;
      if (!required || required.length === 0) {
        noParamTools.push(tool);
      } else {
        paramTools.push(tool);
      }
    }

    // ========== 3. 预执行无参数工具 ==========
    let preExecutedData = '';
    const preExecutedCalls: { tool: string; args: Record<string, any>; result: any }[] = [];

    if (noParamTools.length > 0) {
      aiLogger.debug(`预执行无参数工具: ${noParamTools.map(t => t.name).join(', ')}`);
      const results = await Promise.allSettled(
        noParamTools.map(async (tool) => {
          const result = await Promise.race([
            tool.execute({}),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('预执行超时')), AIService.PRE_EXEC_TIMEOUT),
            ),
          ]);
          return { name: tool.name, result };
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { name, result } = r.value;
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          preExecutedData += `\n【${name}】${resultStr}`;
          preExecutedCalls.push({ tool: name, args: {}, result });
        }
      }
    }

    // ========== 4. 选择路径 ==========
    let finalResponse: string;

    if (paramTools.length === 0 && preExecutedData) {
      // ── 快速路径：所有工具都已预执行 → 1 次 AI 往返 ──
      aiLogger.debug('快速路径: 预执行完成，单次 AI 生成回答');

      const singleShotPrompt = `你是一个友好的中文 AI 助手。

以下是根据用户问题自动获取的实时数据：
${preExecutedData}

请基于以上数据回答用户的问题。要求：
- 用自然流畅的中文组织信息，不要直接输出原始数据
- 突出重点，适当使用 emoji 增加趣味性
- 如果数据包含错误或为空，如实告知并给出建议
${RICH_MEDIA_GUIDE}`;

      finalResponse = await this.simpleChat(content, singleShotPrompt);

    } else {
      // ── Agent 路径：存在需要参数的工具 → 2 次 AI 往返 ──
      aiLogger.debug(`Agent 路径: ${paramTools.length} 个需参数工具, ${preExecutedCalls.length} 个已预执行`);

      const agentSystemPrompt = `你是一个友好的中文 AI 助手。
${preExecutedData ? `\n以下数据已自动获取：${preExecutedData}\n` : ''}
## 工作流程
1. 分析用户的问题
2. 如果已获取的数据能回答问题，直接作答
3. 如果还需要更多信息，调用工具获取（直接调用，不要解释）
4. 获取工具结果后，**务必**生成一条完整、自然的中文回答

## 关键要求
- 调用工具后你**必须**基于结果给出完整回答，绝不能返回空内容
- 用自然语言总结工具结果，突出关键信息
- 适当使用 emoji 让回答更生动
- 如果工具返回了错误，告知用户并给出建议
${RICH_MEDIA_GUIDE}`;

      const agent = this.createAgent({
        systemPrompt: agentSystemPrompt,
        tools: paramTools.length > 0 ? paramTools : relevantTools,
        useBuiltinTools: false,
        collectExternalTools: false,
        maxIterations: 3,
      });

      const agentResult = await agent.run(content);

      // 直接使用 Agent 输出（forceAnswer 保证最后一轮有文本），不再额外调 summarize
      finalResponse = agentResult.content || this.formatToolCallsFallback(
        [...preExecutedCalls, ...agentResult.toolCalls],
      );
    }

    // 保存到会话
    await this.sessions.addMessage(sessionId, { role: 'user', content });
    await this.sessions.addMessage(sessionId, { role: 'assistant', content: finalResponse });

    // 异步检查是否需要总结
    if (this.contextManager && sceneId) {
      this.contextManager.autoSummarizeIfNeeded(sceneId).catch(() => {});
    }

    return finalResponse;
  }

  /**
   * 简单对话 + 保存会话（复用逻辑）
   */
  private async finishAndSave(
    sessionId: string,
    content: string,
    systemPrompt: string,
    sceneId?: string,
  ): Promise<string> {
    const response = await this.simpleChat(content, systemPrompt);
    await this.sessions.addMessage(sessionId, { role: 'user', content });
    await this.sessions.addMessage(sessionId, { role: 'assistant', content: response });
    if (this.contextManager && sceneId) {
      this.contextManager.autoSummarizeIfNeeded(sceneId).catch(() => {});
    }
    return response;
  }

  /**
   * 工具结果本地格式化（纯文本兜底，不调用 AI）
   */
  private formatToolCallsFallback(
    toolCalls: { tool: string; args: any; result: any }[],
  ): string {
    if (toolCalls.length === 0) return '处理完成。';
    return toolCalls.map(tc => {
      const resultStr = typeof tc.result === 'string'
        ? tc.result
        : JSON.stringify(tc.result, null, 2);
      return `【${tc.tool}】\n${resultStr}`;
    }).join('\n\n');
  }

  /**
   * 简单对话（不使用会话历史）
   */
  private async simpleChat(content: string, systemPrompt: string): Promise<string> {
    const provider = this.getProvider();
    const response = await this.chat({
      model: provider.models[0],
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    });
    const msgContent = response.choices[0]?.message?.content;
    return typeof msgContent === 'string' ? msgContent : '';
  }

  /**
   * @deprecated 已被 Agent.filterTools() 程序化过滤替代，不再从 process() 中调用。
   * 保留此方法以供外部调用者使用（如果需要 AI 辅助选择工具）。
   *
   * 意图分析，筛选相关工具
   * 使用 AI 分析用户意图，选择最相关的工具
   */
  async analyzeIntentAndSelectTools(
    userContent: string,
    allTools: AgentTool[]
  ): Promise<AgentTool[]> {
    // 构建工具列表（包含完整描述）
    const toolList = allTools.map(t => `- ${t.name}: ${t.description}`).join('\n');
    
    const analysisPrompt = `你是一个工具选择助手。分析用户的问题，选择可能需要的工具。

## 重要说明
- 这些工具提供**本系统的真实数据**，不是通用知识
- 例如 "ai.models" 返回本系统配置的实际 AI 模型列表
- 优先使用工具获取实时数据，而不是依赖通用知识回答

## 可用工具
${toolList}

## 用户问题
${userContent}

## 输出要求
- 只输出工具名称，用逗号分隔
- 最多选择 3 个最相关的工具
- 只有当用户的问题与任何工具都无关时，输出：无
- 不要输出任何解释

需要的工具：`;

    try {
      const provider = this.getProvider();
      const response = await this.chat({
        model: provider.models[0],
        messages: [
          { role: 'system', content: '你是一个工具选择助手。根据用户问题分析需要哪些工具，只输出工具名称。' },
          { role: 'user', content: analysisPrompt },
        ],
        temperature: 0.1, // 低温度，更确定性
      });
      
      const content = response.choices[0]?.message?.content;
      const responseText = typeof content === 'string' ? content : '';
      
      // 解析响应
      if (!responseText || responseText.includes('无') || responseText.toLowerCase().includes('none')) {
        return [];
      }
      
      // 提取工具名称
      const toolNames = responseText
        .replace(/[，、]/g, ',')  // 中文逗号转英文
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s && s !== '无' && s !== 'none');
      
      // 匹配工具（精确匹配 + 模糊匹配）
      const selectedTools = allTools.filter(tool => {
        const toolNameLower = tool.name.toLowerCase();
        return toolNames.some(name => 
          toolNameLower === name || 
          toolNameLower.includes(name) || 
          name.includes(toolNameLower)
        );
      });
      
      // 如果 AI 选择了但没匹配到，降级到关键词匹配
      if (selectedTools.length === 0 && toolNames.length > 0) {
        aiLogger.debug('AI 选择未匹配，降级到关键词匹配');
        return this.matchToolsByKeywords(userContent, allTools);
      }
      
      return selectedTools.slice(0, 5);
    } catch (error) {
      aiLogger.warn('意图分析失败，降级到关键词匹配:', error);
      return this.matchToolsByKeywords(userContent, allTools);
    }
  }

  /**
   * @deprecated 已被 Agent.filterTools() 程序化过滤替代。
   * 保留此方法以供外部调用者使用。
   *
   * 基于硬编码关键词匹配工具
   */
  matchToolsByKeywords(content: string, tools: AgentTool[]): AgentTool[] {
    const keywords = content.toLowerCase();
    
    // Debug: 输出可用工具列表
    aiLogger.debug(`关键词匹配 - 输入: "${content}"`);
    aiLogger.debug(`关键词匹配 - 可用工具: ${tools.map(t => t.name).join(', ')}`);
    
    const keywordMap: Record<string, string[]> = {
      '模型': ['ai.models', 'models'],
      '可用模型': ['ai.models'],
      'ai模型': ['ai.models'],
      '清除': ['ai.clear', 'clear'],
      '清空': ['ai.clear', 'clear'],
      '统计': ['ai.stats', 'stats'],
      '工具': ['ai.tools', 'tools'],
      '总结': ['ai.summary', 'summary'],
      '健康': ['ai.health', 'health'],
      '天气': ['weather'],
      '热搜': ['weibo_hot', 'zhihu_hot', 'douyin_hot', 'toutiao_hot'],
      '微博': ['weibo_hot'],
      '知乎': ['zhihu_hot'],
      '抖音': ['douyin_hot'],
      '头条': ['toutiao_hot'],
      '新闻': ['60s_news'],
      '60': ['60s_news'],
      '金价': ['gold_price'],
      '黄金': ['gold_price'],
      '油价': ['fuel_price'],
      '汇率': ['exchange_rate'],
      '翻译': ['translate_60s', 'translate'],
      '历史': ['history_today', 'ai.clear', 'ai.stats'],
      '一言': ['hitokoto'],
      '摸鱼': ['moyu'],
      '计算': ['calculator'],
      '时间': ['get_time'],
      '日期': ['get_time'],
      'kfc': ['kfc'],
      '疯狂星期四': ['kfc'],
      '段子': ['duanzi'],
      '笑话': ['duanzi'],
      'ip': ['ip_query'],
      '壁纸': ['bing_image'],
    };
    
    const matchedNames = new Set<string>();
    for (const [keyword, toolNames] of Object.entries(keywordMap)) {
      if (keywords.includes(keyword)) {
        aiLogger.debug(`关键词匹配 - 匹配到关键词 "${keyword}" -> ${toolNames.join(', ')}`);
        toolNames.forEach(name => matchedNames.add(name));
      }
    }
    
    aiLogger.debug(`关键词匹配 - 需要的工具名: ${Array.from(matchedNames).join(', ')}`);
    
    const matched = tools.filter(t => matchedNames.has(t.name));
    aiLogger.debug(`关键词匹配 - 最终匹配: ${matched.map(t => t.name).join(', ') || '无'}`);
    
    return matched.slice(0, 5);
  }

  /**
   * 第三步：总结工具调用结果
   */
  private async summarizeToolResults(
    userQuestion: string,
    toolCalls: { tool: string; args: any; result: any }[]
  ): Promise<string> {
    // 构建工具结果描述
    const resultsDesc = toolCalls.map(tc => {
      const resultStr = typeof tc.result === 'string' 
        ? tc.result 
        : JSON.stringify(tc.result, null, 2);
      return `工具 ${tc.tool} 的结果：\n${resultStr}`;
    }).join('\n\n');
    
    const summaryPrompt = `用户问题：${userQuestion}

工具调用结果：
${resultsDesc}

请用友好的中文总结以上信息，回答用户的问题。要求：
1. 使用自然语言，不要直接复制原始数据
2. 突出重点信息
3. 可以适当使用 emoji 增加趣味性
4. 保持简洁明了
5. 如果工具返回了图片/音频/视频 URL，请使用对应的标签展示`;

    try {
      const provider = this.getProvider();
      const response = await this.chat({
        model: provider.models[0],
        messages: [
          { role: 'system', content: `你是一个友好的中文助手，擅长用简洁生动的语言总结信息。
${RICH_MEDIA_GUIDE}` },
          { role: 'user', content: summaryPrompt },
        ],
      });
      const msgContent = response.choices[0]?.message?.content;
      return typeof msgContent === 'string' ? msgContent : resultsDesc;
    } catch (error) {
      aiLogger.warn('结果总结失败:', error);
      // 降级：直接返回工具结果
      const lastResult = toolCalls[toolCalls.length - 1]?.result;
      return typeof lastResult === 'string' ? lastResult : JSON.stringify(lastResult, null, 2);
    }
  }

  /**
   * 收集所有工具（包括外部传入的）
   * 注意：过滤掉命令转换的工具（cmd_xxx），避免工具过多影响模型性能
   */
  private collectAllToolsWithExternal(externalTools: Tool[]): AgentTool[] {
    const tools: AgentTool[] = [];
    
    // 1. 内置工具
    tools.push(...this.builtinTools);
    
    // 2. 自定义工具
    tools.push(...this.customTools.values());
    
    // 3. 外部工具（转换为 AgentTool，过滤掉命令工具）
    for (const tool of externalTools) {
      // 跳过命令转换的工具和进程相关工具，避免工具过多
      if (tool.name.startsWith('cmd_') || tool.name.startsWith('process_')) {
        continue;
      }
      tools.push(this.convertToolToAgentTool(tool));
    }
    
    // 限制工具数量，避免超出模型能力
    const maxTools = 30;
    if (tools.length > maxTools) {
      aiLogger.debug(`工具数量 ${tools.length} 超过限制，截取前 ${maxTools} 个`);
      return tools.slice(0, maxTools);
    }
    
    return tools;
  }

  /**
   * 权限级别字符串 → 数字映射
   */
  private static readonly PERM_MAP: Record<string, number> = {
    'user': 0,
    'group_admin': 1,
    'group_owner': 2,
    'bot_admin': 3,
    'owner': 4,
  };

  /**
   * 将 Tool 转换为 AgentTool（保留 tags / keywords / permissionLevel 元数据）
   */
  private convertToolToAgentTool(tool: Tool): AgentTool {
    const agentTool: AgentTool = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as any,
      execute: tool.execute,
    };

    // 携带标签 → 用于程序化过滤
    if (tool.tags?.length) {
      agentTool.tags = tool.tags;
    }

    // 携带权限级别 → 用于程序化过滤
    if (tool.permissionLevel) {
      agentTool.permissionLevel = AIService.PERM_MAP[tool.permissionLevel] ?? 0;
    }

    // 从 name + description 中自动提取关键词（如果工具未显式声明 keywords）
    // 这里通过 (tool as any).keywords 来支持扩展字段
    if ((tool as any).keywords?.length) {
      agentTool.keywords = (tool as any).keywords;
    }

    return agentTool;
  }

  // ============================================================================
  // 原有方法
  // ============================================================================

  /**
   * 设置会话管理器（用于切换到数据库存储）
   */
  setSessionManager(manager: SessionManager): void {
    this.sessions.dispose();
    this.sessions = manager;
  }

  /**
   * 设置上下文管理器
   */
  setContextManager(manager: ContextManager): void {
    this.contextManager = manager;
    const defaultProvider = this.providers.get(this.defaultProvider);
    if (defaultProvider) {
      manager.setAIProvider(defaultProvider);
    }
  }

  /**
   * 设置插件引用（用于收集工具）
   */
  setPlugin(plugin: Plugin): void {
    this.plugin = plugin;
  }

  /**
   * 注册自定义工具到 AI 服务
   */
  registerTool(tool: AgentTool): () => void {
    this.customTools.set(tool.name, tool);
    return () => {
      this.customTools.delete(tool.name);
    };
  }

  /**
   * 收集所有可用工具
   */
  collectAllTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    
    tools.push(...this.builtinTools);
    tools.push(...this.customTools.values());
    
    if (this.plugin) {
      const pluginTools = this.plugin.collectAllTools();
      for (const tool of pluginTools) {
        tools.push(this.convertToolToAgentTool(tool));
      }
    }
    
    return tools;
  }

  getContextConfig(): ContextConfig {
    return this.contextConfig;
  }

  getSessionConfig(): { maxHistory?: number; expireMs?: number } {
    return this.sessionConfig;
  }

  getTriggerConfig(): AITriggerConfig {
    return this.triggerConfig;
  }

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  getProvider(name?: string): AIProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`AI Provider "${providerName}" not found. Available: ${this.listProviders().join(', ')}`);
    }
    return provider;
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  async listModels(providerName?: string): Promise<{ provider: string; models: string[] }[]> {
    const result: { provider: string; models: string[] }[] = [];

    if (providerName) {
      const provider = this.getProvider(providerName);
      const models = await provider.listModels?.() || provider.models;
      result.push({ provider: providerName, models });
    } else {
      for (const [name, provider] of this.providers) {
        const models = await provider.listModels?.() || provider.models;
        result.push({ provider: name, models });
      }
    }

    return result;
  }

  async chat(
    request: ChatCompletionRequest,
    providerName?: string
  ): Promise<ChatCompletionResponse> {
    const provider = this.getProvider(providerName);
    return provider.chat(request);
  }

  async *chatStream(
    request: ChatCompletionRequest,
    providerName?: string
  ): AsyncIterable<ChatCompletionChunk> {
    const provider = this.getProvider(providerName);
    yield* provider.chatStream(request);
  }

  async ask(
    question: string,
    options: {
      provider?: string;
      model?: string;
      systemPrompt?: string;
      temperature?: number;
    } = {}
  ): Promise<string> {
    const messages: ChatMessage[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    messages.push({ role: 'user', content: question });

    const provider = this.getProvider(options.provider);
    const response = await provider.chat({
      model: options.model || provider.models[0],
      messages,
      temperature: options.temperature,
    });

    const content = response.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  async chatWithSession(
    sessionId: string,
    message: string,
    options: {
      provider?: string;
      model?: string;
      systemPrompt?: string;
      stream?: boolean;
    } = {}
  ): Promise<string | AsyncIterable<string>> {
    const session = await this.sessions.get(sessionId, {
      provider: options.provider || this.defaultProvider,
      model: options.model,
      systemPrompt: options.systemPrompt,
    });

    if (options.systemPrompt && !session.messages.some((m: ChatMessage) => m.role === 'system')) {
      await this.sessions.setSystemPrompt(sessionId, options.systemPrompt);
    }

    await this.sessions.addMessage(sessionId, { role: 'user', content: message });

    const provider = this.getProvider(options.provider);
    const model = options.model || session.config.model || provider.models[0];

    if (options.stream) {
      const self = this;
      async function* streamResponse(): AsyncIterable<string> {
        let fullContent = '';
        const messages = await self.sessions.getMessages(sessionId);

        for await (const chunk of provider.chatStream({
          model,
          messages,
        })) {
          const content = chunk.choices[0]?.delta?.content;
          if (content && typeof content === 'string') {
            fullContent += content;
            yield content;
          }
        }

        await self.sessions.addMessage(sessionId, { role: 'assistant', content: fullContent });
      }

      return streamResponse();
    }

    const messages = await this.sessions.getMessages(sessionId);
    const response = await provider.chat({
      model,
      messages,
    });

    const content = response.choices[0]?.message?.content;
    const responseText = typeof content === 'string' ? content : '';

    await this.sessions.addMessage(sessionId, { role: 'assistant', content: responseText });

    return responseText;
  }

  createAgent(options: {
    provider?: string;
    model?: string;
    systemPrompt?: string;
    tools?: AgentTool[];
    useBuiltinTools?: boolean;
    collectExternalTools?: boolean;
    maxIterations?: number;
  } = {}): Agent {
    const provider = this.getProvider(options.provider);
    
    let tools: AgentTool[] = [];
    
    if (options.useBuiltinTools !== false) {
      tools.push(...this.builtinTools);
    }
    
    if (options.collectExternalTools !== false) {
      tools.push(...this.customTools.values());
      
      if (this.plugin) {
        const pluginTools = this.plugin.collectAllTools();
        for (const tool of pluginTools) {
          tools.push(this.convertToolToAgentTool(tool));
        }
      }
    }
    
    if (options.tools?.length) {
      tools.push(...options.tools);
    }

    return createAgent(provider, {
      model: options.model,
      systemPrompt: options.systemPrompt,
      tools,
      maxIterations: options.maxIterations,
    });
  }

  async runAgent(
    task: string,
    options: {
      provider?: string;
      model?: string;
      tools?: AgentTool[];
      systemPrompt?: string;
    } = {}
  ): Promise<{ content: string; toolCalls: any[]; usage: any }> {
    const agent = this.createAgent(options);
    return agent.run(task);
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [name, provider] of this.providers) {
      try {
        results[name] = await provider.healthCheck?.() ?? true;
      } catch {
        results[name] = false;
      }
    }

    return results;
  }

  dispose(): void {
    this.sessions.dispose();
    this.providers.clear();
  }
}

// ============================================================================
// 插件入口
// ============================================================================

// 使用全局标志防止重复初始化
// 因为 Plugin.create 使用 ?t=timestamp 导入模块，导致模块被多次实例化
const AI_INIT_KEY = Symbol.for('@zhin.js/ai:initialized');
const globalState = globalThis as any;

const plugin = usePlugin();
const { provide, useContext, defineModel, root, logger } = plugin;

// 只在第一次加载时注册服务
if (!globalState[AI_INIT_KEY]) {
  globalState[AI_INIT_KEY] = true;
  
  // 注册数据模型（如果数据库服务可用）
  if (typeof defineModel === 'function') {
    defineModel('chat_messages', CHAT_MESSAGE_MODEL);
    defineModel('context_summaries', CONTEXT_SUMMARY_MODEL);
    defineModel('ai_sessions', AI_SESSION_MODEL);
  }

  // 注册 Tool Service
  provide(createToolService());

  logger.debug('AI plugin services registered (tool)');

  // AI 服务实例
  let aiServiceInstance: AIService | null = null;

  // 注册 AI Context
  provide({
    name: 'ai',
    description: 'AI Service - Multi-model LLM integration',
    async mounted(p: Plugin) {
      const configService = root.inject('config');
      const appConfig = configService?.get<{ ai?: AIConfig }>('zhin.config.yml') || {};
      const config = appConfig.ai || {};

      if (config.enabled === false) {
        logger.info('AI Service is disabled');
        return null as any;
      }

      const service = new AIService(config);
      aiServiceInstance = service;
      
      service.setPlugin(root);
      
      const providers = service.listProviders();
      if (providers.length === 0) {
        logger.warn('No AI providers configured. Please add API keys in zhin.config.yml');
      } else {
        logger.info(`AI Service started with providers: ${providers.join(', ')}`);
      }

      return service;
    },
    async dispose(service: AIService | null) {
      if (service) {
        service.dispose();
        aiServiceInstance = null;
        logger.info('AI Service stopped');
      }
    },
  });

  // ============================================================================
  // AI 触发中间件（直接定义，无需单独服务）
  // ============================================================================

  // 当 AI 服务就绪时，注册 AI 触发中间件
  useContext('ai', (ai: AIService) => {
    const rawConfig = ai.getTriggerConfig();
    const triggerConfig = mergeAITriggerConfig(rawConfig);
    
    if (!triggerConfig.enabled) {
      logger.info('AI Trigger is disabled');
      return;
    }
    
    // 直接创建 AI 触发中间件
    const aiTriggerMiddleware = async (message: Message<any>, next: () => Promise<void>) => {
      // 检查消息是否已被命令处理（通过检查 $handled 标记）
      if ((message as any).$handled) {
        return await next();
      }
      
      const text = extractTextContent(message).trim();
      
      // 检查是否匹配已注册的命令（避免与命令冲突）
      const commandService = root.inject('command') as any;
      if (commandService?.items) {
        for (const cmd of commandService.items) {
          // MessageCommand 的 name 或 pattern
          const cmdName = cmd.name || cmd.pattern?.split(/\s/)[0];
          if (cmdName && text.startsWith(cmdName)) {
            // 消息匹配命令，跳过 AI 处理
            logger.debug(`AI Trigger: 跳过命令 "${cmdName}"`);
            return await next();
          }
        }
      }
      
      // 检查是否匹配工具生成的命令
      const toolSvc = root.inject('tool') as any;
      if (toolSvc?.toolCommands) {
        for (const [toolName] of toolSvc.toolCommands) {
          if (text.startsWith(toolName)) {
            logger.debug(`AI Trigger: 跳过工具命令 "${toolName}"`);
            return await next();
          }
        }
      }
      
      // 检查是否触发
      const { triggered, content } = shouldTriggerAI(message, triggerConfig);
      
      if (!triggered) {
        return await next();
      }
      
      // 检查 AI 服务是否就绪
      if (!ai.isReady()) {
        return await next();
      }
      
      // 发送思考中提示
      if (triggerConfig.thinkingMessage) {
        await message.$reply(triggerConfig.thinkingMessage);
      }
      
      // 推断发送者权限
      const permissions = inferSenderPermissions(message, triggerConfig);
      
      // 构建工具上下文
      const toolContext: ToolContext = {
        platform: message.$adapter,
        botId: message.$bot,
        sceneId: message.$channel?.id || message.$sender.id,
        senderId: message.$sender.id,
        message,
        scope: permissions.scope,
        senderPermissionLevel: permissions.permissionLevel,
        isGroupAdmin: permissions.isGroupAdmin,
        isGroupOwner: permissions.isGroupOwner,
        isBotAdmin: permissions.isBotAdmin,
        isOwner: permissions.isOwner,
      };
      
      // 收集可用工具
      const toolService = root.inject('tool');
      let tools = toolService ? toolService.collectAll(root) : [];
      
      // 根据上下文过滤工具
      if (toolService && tools.length > 0) {
        tools = toolService.filterByContext(tools, toolContext);
        logger.debug(`AI Trigger: ${tools.length} tools available after filtering`);
      }
      
      try {
        // 设置超时
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('AI 响应超时')), triggerConfig.timeout);
        });
        
        // 处理 AI 请求
        const responsePromise = ai.process(content, toolContext, tools);
        const response = await Promise.race([responsePromise, timeoutPromise]);
        
        // 处理流式响应
        if (response && typeof response === 'object' && Symbol.asyncIterator in response) {
          let fullContent = '';
          for await (const chunk of response as AsyncIterable<string>) {
            fullContent += chunk;
          }
          if (fullContent) {
            const elements = parseRichMediaContent(fullContent);
            await message.$reply(elements);
          }
        } else if (response) {
          const elements = parseRichMediaContent(response as string);
          await message.$reply(elements);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorResponse = triggerConfig.errorTemplate.replace('{error}', errorMsg);
        await message.$reply(errorResponse);
      }
      
      await next();
    };
    
    // 注册中间件
    const dispose = root.addMiddleware(aiTriggerMiddleware);
    
    logger.info('AI Trigger middleware registered');
    logger.info(`  - Prefixes: ${triggerConfig.prefixes.join(', ')}`);
    logger.info(`  - Respond to @: ${triggerConfig.respondToAt}`);
    logger.info(`  - Respond to private: ${triggerConfig.respondToPrivate}`);
    
    return () => {
      dispose();
      logger.info('AI Trigger middleware unregistered');
    };
  });

  // ============================================================================
  // 数据库集成
  // ============================================================================

  useContext('database', (db) => {
  setTimeout(() => {
    if (!aiServiceInstance) {
      logger.debug('AI Service not ready, skipping database session manager setup');
      return;
    }

    const configService = root.inject('config');
    const appConfig = configService?.get<{ ai?: AIConfig }>('zhin.config.yml') || {};
    const config = appConfig.ai || {};

    if (config.sessions?.useDatabase === false) {
      logger.info('AI Session: Using memory storage (database disabled in config)');
      return;
    }

    try {
      
      const model = db.models.get('ai_sessions');
      if (!model) {
        logger.warn('AI Session: Failed to get model, falling back to memory storage');
        return;
      }

      const dbSessionManager = createDatabaseSessionManager(model, aiServiceInstance.getSessionConfig());
      aiServiceInstance.setSessionManager(dbSessionManager);
      
      logger.info('AI Session: Switched to database storage for persistent memory');

      const contextConfig = aiServiceInstance.getContextConfig();
      if (contextConfig.enabled !== false) {
        try {

          const messageModel = db.models.get('chat_messages');
          const summaryModel = db.models.get('context_summaries');

          if (messageModel && summaryModel) {
            const contextManager = createContextManager(messageModel, summaryModel, contextConfig);
            aiServiceInstance.setContextManager(contextManager);
            logger.info('AI Context: Message recording and smart summary enabled');
          }
        } catch (error) {
          logger.error('AI Context: Failed to setup context manager:', error);
        }
      }
    } catch (error) {
      logger.error('AI Session: Failed to setup database storage:', error);
      logger.info('AI Session: Falling back to memory storage');
    }
  }, 100);
});

// ============================================================================
// 消息记录中间件
// ============================================================================

root.addMiddleware(async (message: Message, next: () => Promise<void>) => {
  await next();

  if (aiServiceInstance?.contextManager) {
    const record: MessageRecord = {
      platform: message.$adapter,
      scene_id: message.$channel?.id || message.$sender.id,
      scene_type: message.$channel?.type || 'private',
      scene_name: (message.$channel as any)?.name || '',
      sender_id: message.$sender.id,
      sender_name: message.$sender.name || message.$sender.id,
      message: typeof message.$raw === 'string' ? message.$raw : JSON.stringify(message.$raw),
      time: message.$timestamp || Date.now(),
    };

    aiServiceInstance.contextManager.recordMessage(record).catch(err => {
      logger.debug('Failed to record message:', err);
    });
  }
});

// ============================================================================
// AI 管理工具 (使用 ZhinTool，同时支持 AI 调用和命令调用)
// ============================================================================

useContext('ai', 'tool', (ai: AIService | undefined, toolService: any) => {
  if (!ai || !toolService) return;

  // 列出模型工具
  const listModelsTool = new ZhinTool('ai.models')
    .desc('列出所有可用的 AI 模型')
    .keyword('模型', '可用模型', 'ai模型', 'model', 'models')
    .tag('ai', 'management')
    .execute(async () => {
      const models = await ai.listModels();
      return {
        providers: models.map(({ provider, models: modelList }) => ({
          name: provider,
          models: modelList.slice(0, 10),
          total: modelList.length,
        })),
      };
    })
    .action(async () => {
      try {
        const models = await ai.listModels();
        let response = '🤖 可用模型:\n';

        for (const { provider, models: modelList } of models) {
          response += `\n【${provider}】\n`;
          response += modelList.slice(0, 5).map((m: string) => `  • ${m}`).join('\n');
          if (modelList.length > 5) {
            response += `\n  ... 还有 ${modelList.length - 5} 个`;
          }
        }

        return response;
      } catch (error) {
        return `❌ 错误: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

  // 清除会话工具
  const clearSessionTool = new ZhinTool('ai.clear')
    .desc('清除当前对话的历史记录')
    .keyword('清除', '清空', '重置', '清理', 'clear', 'reset')
    .tag('ai', 'session')
    .execute(async (_args, context) => {
      if (!context?.message) return { success: false, error: '无法获取消息上下文' };
      
      const message = context.message as Message;
      const sessionId = SessionManager.generateId(
        message.$adapter,
        message.$sender.id,
        message.$channel?.id
      );

      await ai.sessions.reset(sessionId);
      return { success: true, message: '对话历史已清除' };
    })
    .action(async (message: Message) => {
      const sessionId = SessionManager.generateId(
        message.$adapter,
        message.$sender.id,
        message.$channel?.id
      );

      await ai.sessions.reset(sessionId);
      return '✅ 对话历史已清除';
    });

  // 场景统计工具
  const sceneStatsTool = new ZhinTool('ai.stats')
    .desc('查看当前场景的消息统计')
    .keyword('统计', '消息数', '场景统计', 'stats', 'analytics')
    .tag('ai', 'analytics')
    .execute(async (_args, context) => {
      if (!context?.message) return { error: '无法获取消息上下文' };
      if (!ai.contextManager) return { error: '上下文管理器未启用' };
      
      const message = context.message as Message;
      const sceneId = message.$channel?.id || message.$sender.id;
      const stats = await ai.contextManager.getSceneStats(sceneId);
      
      return {
        sceneId,
        messageCount: stats.messageCount,
        summaryCount: stats.summaryCount,
        firstMessageTime: stats.firstMessageTime,
        lastMessageTime: stats.lastMessageTime,
      };
    })
    .action(async (message: Message) => {
      const sceneId = message.$channel?.id || message.$sender.id;
      
      if (!ai.contextManager) {
        return '⚠️ 上下文管理器未启用';
      }

      try {
        const stats = await ai.contextManager.getSceneStats(sceneId);
        return [
          `📊 场景统计 (${sceneId})`,
          `• 消息数: ${stats.messageCount}`,
          `• 总结数: ${stats.summaryCount}`,
          stats.firstMessageTime ? `• 首条消息: ${new Date(stats.firstMessageTime).toLocaleString()}` : '',
          stats.lastMessageTime ? `• 最新消息: ${new Date(stats.lastMessageTime).toLocaleString()}` : '',
        ].filter(Boolean).join('\n');
      } catch (error) {
        return `❌ 错误: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

  // 列出工具工具
  const listToolsTool = new ZhinTool('ai.tools')
    .desc('列出所有可用的 AI 工具')
    .keyword('工具', '可用工具', 'tools', '功能')
    .tag('ai', 'management')
    .execute(async () => {
      const allTools = ai.collectAllTools();
      
      const groupedTools: Record<string, { name: string; description: string }[]> = {};
      for (const tool of allTools) {
        const source = (tool as any).source || 'builtin';
        if (!groupedTools[source]) {
          groupedTools[source] = [];
        }
        groupedTools[source].push({
          name: tool.name,
          description: tool.description,
        });
      }
      
      return {
        total: allTools.length,
        groups: groupedTools,
      };
    })
    .action(async () => {
      try {
        const allTools = ai.collectAllTools();
        
        if (allTools.length === 0) {
          return '📦 暂无可用工具';
        }
        
        const groupedTools: Record<string, typeof allTools> = {};
        for (const tool of allTools) {
          const source = (tool as any).source || 'builtin';
          if (!groupedTools[source]) {
            groupedTools[source] = [];
          }
          groupedTools[source].push(tool);
        }
        
        const lines: string[] = ['🔧 可用工具列表:\n'];
        
        for (const [source, tools] of Object.entries(groupedTools)) {
          lines.push(`📁 ${source}:`);
          for (const tool of tools.slice(0, 10)) {
            lines.push(`  • ${tool.name}: ${tool.description.substring(0, 50)}${tool.description.length > 50 ? '...' : ''}`);
          }
          if (tools.length > 10) {
            lines.push(`  ... 还有 ${tools.length - 10} 个`);
          }
          lines.push('');
        }
        
        lines.push(`总计: ${allTools.length} 个工具`);
        
        return lines.join('\n');
      } catch (error) {
        return `❌ 错误: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

  // 对话总结工具
  const summarizeTool = new ZhinTool('ai.summary')
    .desc('生成当前场景的对话总结')
    .keyword('总结', '摘要', '概括', 'summary', 'summarize')
    .tag('ai', 'context')
    .execute(async (_args, context) => {
      if (!context?.message) return { error: '无法获取消息上下文' };
      if (!ai.contextManager) return { error: '上下文管理器未启用' };
      
      const message = context.message as Message;
      const sceneId = message.$channel?.id || message.$sender.id;
      const summaryText = await ai.contextManager.summarize(sceneId);
      
      return summaryText 
        ? { success: true, summary: summaryText }
        : { success: false, error: '没有足够的历史消息进行总结' };
    })
    .action(async (message: Message) => {
      const sceneId = message.$channel?.id || message.$sender.id;
      
      if (!ai.contextManager) {
        return '⚠️ 上下文管理器未启用';
      }

      try {
        const summaryText = await ai.contextManager.summarize(sceneId);
        if (summaryText) {
          return `📝 对话总结:\n\n${summaryText}`;
        }
        return '⚠️ 没有足够的历史消息进行总结';
      } catch (error) {
        return `❌ 总结失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

  // 健康检查工具
  const healthCheckTool = new ZhinTool('ai.health')
    .desc('检查 AI 服务的健康状态')
    .keyword('健康', '状态', '检查', 'health', 'status')
    .tag('ai', 'management')
    .execute(async () => {
      const health = await ai.healthCheck();
      return {
        providers: Object.entries(health).map(([name, isHealthy]) => ({
          name,
          healthy: isHealthy,
        })),
      };
    })
    .action(async () => {
      try {
        const health = await ai.healthCheck();
        const lines = ['🏥 AI 服务健康状态:\n'];
        
        for (const [provider, isHealthy] of Object.entries(health)) {
          lines.push(`  ${isHealthy ? '✅' : '❌'} ${provider}`);
        }
        
        return lines.join('\n');
      } catch (error) {
        return `❌ 健康检查失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    });

  // 注册所有工具
  const tools = [
    listModelsTool,
    clearSessionTool,
    sceneStatsTool,
    listToolsTool,
    summarizeTool,
    healthCheckTool,
  ];

  const disposers: (() => void)[] = [];
  for (const tool of tools) {
    disposers.push(toolService.add(tool, root));
  }

  logger.debug(`Registered ${tools.length} AI management tools`);

  return () => {
    disposers.forEach(dispose => dispose());
  };
});

} // 结束 if (!_initialized) 块

// ============================================================================
// 创建 AI 服务（供 setup.ts 直接使用）
// ============================================================================

/**
 * 创建 AI 服务 Context
 * 可在 setup.ts 中直接使用：provide(createAIService())
 */
export function createAIService() {
  return {
    name: 'ai' as const,
    description: 'AI Service - Multi-model LLM integration',
    async mounted(p: Plugin) {
      const configService = p.root.inject('config');
      const appConfig = configService?.get<{ ai?: AIConfig }>('zhin.config.yml') || {};
      const config = appConfig.ai || {};

      if (config.enabled === false) {
        p.logger.info('AI Service is disabled');
        return null as any;
      }

      const service = new AIService(config);
      service.setPlugin(p.root);
      
      const providers = service.listProviders();
      if (providers.length === 0) {
        p.logger.warn('No AI providers configured. Please add API keys in zhin.config.yml');
      } else {
        p.logger.info(`AI Service started with providers: ${providers.join(', ')}`);
      }

      return service;
    },
    async dispose(service: AIService | null) {
      if (service) {
        service.dispose();
      }
    },
  };
}

// ============================================================================
// 导出
// ============================================================================

// AIService 已通过 export class 导出，无需重复导出
export { Agent, createAgent } from './agent.js';
export { SessionManager, createMemorySessionManager, createDatabaseSessionManager } from './session.js';
export { ContextManager, createContextManager, CHAT_MESSAGE_MODEL, CONTEXT_SUMMARY_MODEL } from './context-manager.js';
export type * from './types.js';
export * from './providers/index.js';
export * from './tools.js';

// Tool Service 从 @zhin.js/core 重新导出
export { 
  createToolService,
  defineTool,
  ZhinTool,
  isZhinTool,
  // AI Trigger 工具函数
  shouldTriggerAI,
  inferSenderPermissions,
  parseRichMediaContent,
  extractTextContent,
  mergeAITriggerConfig,
  type ToolService,
  type AITriggerConfig,
} from '@zhin.js/core';
