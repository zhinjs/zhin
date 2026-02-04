/**
 * MCP AI Handlers
 * 处理 AI 相关的 MCP 工具调用
 */

import { usePlugin } from "zhin.js";

const plugin = usePlugin();

// AI 服务类型（从 @zhin.js/ai 导入）
interface AIService {
  ask(message: string, options?: { systemPrompt?: string; model?: string; provider?: string }): Promise<string>;
  runAgent(task: string, options?: { model?: string }): Promise<{
    content: string;
    toolCalls: { tool: string; args: any; result: any }[];
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }>;
  listModels(): Promise<{ provider: string; models: string[] }[]>;
}

/**
 * 获取 AI 服务
 */
function getAIService(): AIService {
  const ai = plugin.root.inject("ai" as any) as AIService | undefined;
  if (!ai) {
    throw new Error(
      "AI 服务未启用。请在 zhin.config.yml 中配置 ai 并添加 API Key"
    );
  }
  return ai;
}

/**
 * AI 对话
 */
export async function aiChat(args: {
  message: string;
  systemPrompt?: string;
  model?: string;
  provider?: string;
}): Promise<string> {
  const ai = getAIService();

  try {
    const response = await ai.ask(args.message, {
      systemPrompt: args.systemPrompt,
      model: args.model,
      provider: args.provider,
    });
    return response;
  } catch (error) {
    return `❌ AI 调用失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * AI Agent 执行任务
 */
export async function aiAgent(args: {
  task: string;
  model?: string;
}): Promise<string> {
  const ai = getAIService();

  try {
    const result = await ai.runAgent(args.task, {
      model: args.model,
    });

    let output = result.content;

    if (result.toolCalls.length > 0) {
      output += "\n\n---\n📋 **使用的工具:**\n";
      for (const tc of result.toolCalls) {
        output += `- **${tc.tool}**: ${JSON.stringify(tc.args)}\n`;
        output += `  结果: ${JSON.stringify(tc.result)}\n`;
      }
    }

    output += `\n---\n📊 Token 使用: ${result.usage.total_tokens} (输入: ${result.usage.prompt_tokens}, 输出: ${result.usage.completion_tokens})`;

    return output;
  } catch (error) {
    return `❌ Agent 执行失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * AI 代码审查
 */
export async function aiCodeReview(args: {
  code: string;
  language?: string;
  focus?: string;
}): Promise<string> {
  const ai = getAIService();

  const systemPrompt = `你是一位资深的代码审查专家。请审查用户提供的代码，并提供专业的改进建议。

审查重点: ${args.focus || "代码质量、可读性、性能、安全性、最佳实践"}
编程语言: ${args.language || "自动检测"}

请按以下格式输出:
1. **代码概述**: 简要描述代码功能
2. **优点**: 代码中做得好的地方
3. **问题**: 需要改进的问题（按严重程度排序）
4. **建议**: 具体的改进建议和示例代码
5. **评分**: 给出 1-10 分的综合评分`;

  try {
    const response = await ai.ask(args.code, { systemPrompt });
    return response;
  } catch (error) {
    return `❌ 代码审查失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * AI 代码解释
 */
export async function aiExplainCode(args: {
  code: string;
  language?: string;
  detail?: "brief" | "detailed";
}): Promise<string> {
  const ai = getAIService();

  const detailLevel =
    args.detail === "brief"
      ? "请简洁地解释，控制在 200 字以内"
      : "请详细解释每个部分的功能";

  const systemPrompt = `你是一位编程教育专家。请解释用户提供的代码。

编程语言: ${args.language || "自动检测"}
${detailLevel}

请包含:
1. 代码的整体功能
2. 关键逻辑的解释
3. 使用的设计模式或技术（如果有）
4. 适用场景`;

  try {
    const response = await ai.ask(args.code, { systemPrompt });
    return response;
  } catch (error) {
    return `❌ 代码解释失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * AI 生成代码
 */
export async function aiGenerateCode(args: {
  requirement: string;
  language?: string;
  framework?: string;
}): Promise<string> {
  const ai = getAIService();

  const systemPrompt = `你是一位专业的软件开发工程师。请根据用户需求生成高质量代码。

目标语言: ${args.language || "TypeScript"}
框架: ${args.framework || "无特定框架"}

要求:
1. 代码需要完整可运行
2. 添加必要的注释
3. 遵循最佳实践
4. 考虑错误处理
5. 如果需要依赖，请列出

请直接输出代码，并在代码后简要说明使用方法。`;

  try {
    const response = await ai.ask(args.requirement, { systemPrompt });
    return response;
  } catch (error) {
    return `❌ 代码生成失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 列出可用模型
 */
export async function aiListModels(): Promise<string> {
  const ai = getAIService();

  try {
    const models = await ai.listModels();
    let output = "# 可用的 AI 模型\n\n";

    for (const { provider, models: modelList } of models) {
      output += `## ${provider}\n`;
      for (const model of modelList) {
        output += `- ${model}\n`;
      }
      output += "\n";
    }

    return output;
  } catch (error) {
    return `❌ 获取模型列表失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}
