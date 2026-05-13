/**
 * ask_user — 基于 Prompt / 私聊 向 Bot Owner 确认或提问
 */
import {
  Prompt,
  Adapter,
  type Plugin,
  type MessageMiddleware,
  type SendOptions,
  type Tool,
  type ToolContext,
  type ToolParametersSchema,
  type ToolResult,
} from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

// ============================================================================
// Prompt / Owner 回复格式化（原 builtin-tools 顶部辅助函数）
// ============================================================================

/**
 * 私聊 Owner 场景：使用 Prompt 类直接交互（原有行为）
 */
export async function askViaPrompt(
  plugin: Plugin,
  message: any,
  args: Record<string, any>,
  questionType: string,
  timeoutMs: number,
): Promise<string> {
  const prompt = new Prompt(plugin, message);
  try {
    switch (questionType) {
      case 'number': {
        const defaultNum = args.default_value != null ? Number(args.default_value) : undefined;
        const result = await prompt.number(args.question, timeoutMs, defaultNum, '输入超时，已取消');
        return String(result);
      }
      case 'confirm': {
        const result = await prompt.confirm(args.question, 'yes', timeoutMs, false, '确认超时，已取消');
        return result ? 'yes' : 'no';
      }
      case 'pick': {
        if (!args.options?.length) {
          return 'Error: type=pick 时必须提供 options 选项列表';
        }
        const pickOptions = (args.options as string[]).map((o: string) => ({ label: o, value: o }));
        const result = await prompt.pick(args.question, {
          type: 'text' as const,
          options: pickOptions,
          timeout: timeoutMs,
        }, '选择超时，已取消');
        return String(result);
      }
      case 'text':
      default: {
        const result = await prompt.text(args.question, timeoutMs, args.default_value || '', '输入超时，已取消');
        return result;
      }
    }
  } catch (e: unknown) {
    return `Owner 未响应或输入错误: ${errMsg(e)}`;
  }
}

/**
 * 将 Owner 私聊回复格式化为对应类型的结果
 */
export function formatOwnerResponse(raw: string, questionType: string, args: Record<string, any>): string {
  switch (questionType) {
    case 'confirm':
      return raw.trim().toLowerCase() === 'yes' ? 'yes' : 'no';
    case 'number':
      return String(Number(raw) || 0);
    case 'pick': {
      const idx = Number(raw.trim());
      const options = (args.options as string[]) || [];
      if (idx >= 1 && idx <= options.length) return options[idx - 1];
      return raw;
    }
    case 'text':
    default:
      return raw;
  }
}

export const ASK_USER_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    question: { type: 'string', description: '要向 Owner 提出的问题文本' },
    type: {
      type: 'string',
      description: '问题类型: text(文本输入)、number(数字输入)、confirm(是/否确认)、pick(选项选择)。默认 text',
    },
    options: {
      type: 'array',
      description: '选项列表（type=pick 时必填），每项为字符串，如 ["选项A","选项B","选项C"]',
    },
    default_value: { type: 'string', description: 'Owner 超时未回复时使用的默认值' },
    timeout: { type: 'number', description: '等待 Owner 回复的超时时间（秒），默认 120' },
  },
  required: ['question'],
};

/**
 * 工厂：`createAskUserTool(plugin)` 或 `createAskUserTool({ plugin })`
 */
export function createAskUserTool(plugin: Plugin): Tool {
  return new AskUserBuiltinTool(plugin).toTool();
}

export class AskUserBuiltinTool extends BuiltinBaseTool {
  readonly name = 'ask_user';
  readonly description =
    '向 Bot Owner 发送问题并等待回复。用于需要确认、补充信息或做出选择时。在群聊中始终通过私聊向 Owner 确认，确保安全性。';
  readonly parameters = ASK_USER_PARAMETERS;
  readonly kind = 'interaction';

  constructor(private readonly plugin: Plugin) {
    super();
    this.tags.push('interaction', 'prompt');
    this.keywords.push(
      '询问',
      '确认',
      '提问',
      '用户输入',
      'ask',
      'confirm',
      'prompt',
      '选择',
      '请问',
    );
  }

  async run(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    if (!context?.message) {
      return 'Error: 当前上下文没有消息来源，无法向 Owner 提问。请改为在回复中直接询问。';
    }
    if (!this.plugin) {
      return 'Error: 插件实例不可用，无法创建交互式提问。请改为在回复中直接询问。';
    }

    const timeoutMs = ((args.timeout as number) ?? 120) * 1000;
    const questionType = (args.type as string) || 'text';
    const recordArgs = args as Record<string, any>;

    const platform = context.platform!;
    const botId = context.botId!;
    const adapter = this.plugin.inject(platform) as Adapter | undefined;
    const bot = adapter?.bots?.get(botId);
    const botOwner: string | undefined = (bot?.$config as any)?.owner;
    const isPrivateOwner = context.scope === 'private'
      && botOwner != null && String(context.senderId) === String(botOwner);

    if (isPrivateOwner) {
      return askViaPrompt(this.plugin, context.message, recordArgs, questionType, timeoutMs);
    }

    if (!botOwner) {
      return 'Error: 当前 Bot 未配置 owner，无法进行安全确认。请在 bots 配置中设置 owner 字段。';
    }

    if (!adapter || typeof adapter.sendMessage !== 'function') {
      return `Error: 无法获取适配器 ${platform}，无法向 Owner 发送私聊确认。`;
    }

    const sourceInfo = context.scope !== 'private'
      ? `来源: ${context.scope}(${context.sceneId}) 用户: ${context.senderId}`
      : `来源: 私聊 用户: ${context.senderId}`;
    let questionText = `🔐 AI 安全确认\n${sourceInfo}\n\n${args.question}`;
    if (questionType === 'confirm') {
      questionText += '\n输入"yes"以确认';
    } else if (questionType === 'pick' && (args.options as any[])?.length) {
      questionText += '\n' + (args.options as string[]).map((o, i) => `${i + 1}.${o}`).join('\n');
    } else if (questionType === 'number') {
      questionText += '\n(请输入数字)';
    }

    try {
      await adapter.sendMessage({
        context: platform,
        bot: botId,
        id: botOwner,
        type: 'private',
        content: questionText,
      } satisfies SendOptions);
    } catch (e: unknown) {
      return `Error: 无法向 Owner 发送私聊消息: ${errMsg(e)}`;
    }

    return new Promise<string>((resolve) => {
      const middleware: MessageMiddleware = async (message, next) => {
        if (message.$channel?.type !== 'private') return next();
        if (String(message.$sender.id) !== String(botOwner)) return next();
        if (String(message.$bot) !== String(botId)) return next();
        dispose();
        clearTimeout(timer);
        const raw = message.$raw;
        resolve(formatOwnerResponse(raw, questionType, recordArgs));
      };
      const dispose = this.plugin!.addMiddleware(middleware);
      const timer = setTimeout(() => {
        dispose();
        if (args.default_value != null) {
          resolve(String(args.default_value));
        } else {
          resolve('Owner 未在规定时间内响应，操作已取消。');
        }
      }, timeoutMs);
    });
  }
}
