/**
 * ask_user — 默认在当前会话（群/频道/私聊）Prompt 提问；敏感确认走私聊 master（群来源带 parent）。
 */
import {
  Prompt,
  Adapter,
  type Plugin,
  type Message,
  type MessageMiddleware,
  type SendOptions,
  type Tool,
  type ToolParametersSchema,
  type ToolResult,
} from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import {
  clearPendingAskUser,
  registerPendingAskUser,
} from './ask-user-session.js';
import {
  buildGroupAskUserFollowUp,
  shouldBlockDelegationAskUser,
} from '../collaboration/ask-user-bridge.js';

// ============================================================================
// Prompt / Owner 回复格式化
// ============================================================================

/**
 * 在当前消息会话内 Prompt 交互（群/频道/私聊均可；仅匹配触发用户）。
 */
export async function askViaPrompt(
  plugin: Plugin,
  message: any,
  args: Record<string, any>,
  questionType: string,
  timeoutMs: number,
): Promise<string> {
  const host = plugin.root ?? plugin;
  const prompt = new Prompt(host, message);
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

export function buildSensitiveOwnerQuestionText(
  commMessage: Message,
  question: string,
  questionType: string,
  options?: string[],
): string {
  const sourceInfo = commMessage.$channel?.type !== 'private'
    ? `来源: ${commMessage.$channel?.type}(${commMessage.$channel?.id}) 用户: ${commMessage.$sender.id}`
    : `来源: 私聊 用户: ${commMessage.$sender.id}`;
  let questionText = `请求确认：\n${sourceInfo}\n\n${question}`;
  if (questionType === 'confirm') {
    questionText += '\n输入"yes"以确认';
  } else if (questionType === 'pick' && options?.length) {
    questionText += '\n' + options.map((o, i) => `${i + 1}.${o}`).join('\n');
  } else if (questionType === 'number') {
    questionText += '\n(请输入数字)';
  }
  return questionText;
}

function isGroupOrChannelScope(message: Message): boolean {
  const scope = message.$channel?.type;
  return scope === 'group' || scope === 'channel';
}

/**
 * 敏感确认：向 Endpoint Owner 发私聊（群/频道来源带 parent），静默不回群。
 */
export async function askOwnerViaPrivateWithParent(
  plugin: Plugin,
  commMessage: Message,
  args: Record<string, any>,
  questionType: string,
  timeoutMs: number,
  botMaster: string,
  adapter: Adapter,
): Promise<string> {
  const platform = commMessage.$adapter!;
  const endpointId = commMessage.$endpoint!;
  const question = String(args.question ?? '');
  const sceneId = String(commMessage.$channel?.id ?? '');
  const parentType = commMessage.$channel?.type === 'channel' ? 'channel' as const : 'group' as const;

  const questionText = buildSensitiveOwnerQuestionText(
    commMessage,
    question,
    questionType,
    args.options as string[] | undefined,
  );

  try {
    await adapter.sendMessage({
      context: platform,
      endpoint: endpointId,
      id: botMaster,
      type: 'private',
      parent: { type: parentType, id: sceneId },
      content: questionText,
    } satisfies SendOptions);
  } catch (e: unknown) {
    return `Error: 无法向 Owner 发送私聊消息: ${errMsg(e)}`;
  }

  const hostPlugin = plugin.root ?? plugin;
  const masterId = String(botMaster);
  const endpointKey = String(endpointId);
  const groupOrigin = commMessage;

  registerPendingAskUser({
    endpointId: endpointKey,
    masterId,
    groupOrigin,
    registeredAt: Date.now(),
  });

  const finish = (rawAnswer: string): string => {
    clearPendingAskUser(endpointKey, masterId);
    return buildGroupAskUserFollowUp(groupOrigin, rawAnswer);
  };

  return new Promise<string>((resolve) => {
    const middleware: MessageMiddleware = async (message, next) => {
      if (message.$channel?.type !== 'private') return next();
      if (String(message.$sender.id) !== masterId) return next();
      if (String(message.$endpoint) !== endpointKey) return next();
      dispose();
      clearTimeout(timer);
      const raw = message.$raw;
      resolve(finish(formatOwnerResponse(raw, questionType, args)));
    };
    const dispose = hostPlugin.addMiddleware(middleware);
    const timer = setTimeout(() => {
      dispose();
      clearPendingAskUser(endpointKey, masterId);
      if (args.default_value != null) {
        resolve(String(args.default_value));
      } else {
        resolve('Owner 未在规定时间内响应，操作已取消。');
      }
    }, timeoutMs);
  });
}

export const ASK_USER_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    question: { type: 'string', description: 'Question text to ask the user or Endpoint Owner' },
    type: {
      type: 'string',
      enum: ['text', 'number', 'confirm', 'pick'],
      description: 'Response type: text, number, confirm (yes/no), or pick (numbered options). Default: text',
    },
    options: {
      type: 'array',
      items: { type: 'string' },
      description: 'Option labels when type=pick (required), e.g. ["Option A","Option B"]',
    },
    default_value: { type: 'string', description: 'Fallback value if the user does not reply before timeout' },
    timeout: { type: 'number', description: 'Wait timeout in seconds. Default: 120' },
    sensitive: {
      type: 'boolean',
      description:
        'When true, send a private confirmation to the Endpoint Owner (group/channel origin includes parent scene). Use for exec approval, secrets, or other sensitive confirms. Do not set for ordinary clarification.',
    },
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
    'Ask the user and wait for a reply. Default: prompt in the current session (group/channel/private) to the triggering user. Set sensitive=true only to confirm with the Endpoint Owner via private DM (group origin uses parent; no group-visible trace). Owner private chat: /approve always bash, /approve rule <regex>, /approve list, /approve revoke. write_file / edit_file / web_fetch hard-orchestration still requires per-action Owner confirm.';
  readonly parameters = ASK_USER_PARAMETERS;
  readonly kind = 'interaction';
  /** 默认等待 120s，须大于 Agent 默认 30s 工具超时 */
  readonly executionTimeoutMs = 150_000;

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

  async run(args: Record<string, unknown>, commMessage?: Message): Promise<ToolResult> {
    if (!commMessage) {
      return 'Error: 当前上下文没有消息来源，无法提问。请改为在回复中直接询问。';
    }
    if (!this.plugin) {
      return 'Error: 插件实例不可用，无法创建交互式提问。请改为在回复中直接询问。';
    }

    const timeoutMs = ((args.timeout as number) ?? 120) * 1000;
    const questionType = (args.type as string) || 'text';
    const recordArgs = args as Record<string, any>;
    const question = String(args.question ?? '');

    const platform = commMessage.$adapter!;
    const endpointId = commMessage.$endpoint!;
    const adapter = this.plugin.inject(platform) as Adapter | undefined;
    const bot = adapter?.endpoints?.get(endpointId);
    const botMaster: string | undefined = (bot?.$config as { master?: string })?.master;
    const isPrivateMaster = commMessage.$channel?.type === 'private'
      && botMaster != null && String(commMessage.$sender.id) === String(botMaster);

    if (isPrivateMaster) {
      return askViaPrompt(this.plugin, commMessage, recordArgs, questionType, timeoutMs);
    }

    const delegationBlock = shouldBlockDelegationAskUser(commMessage, question, questionType);
    if (delegationBlock) return delegationBlock;

    const sensitive = args.sensitive === true;
    if (sensitive && isGroupOrChannelScope(commMessage)) {
      if (!botMaster) {
        return 'Error: 当前 Endpoint 未配置 master，无法进行敏感确认。请在 endpoints 配置中设置 master 字段。';
      }
      if (!adapter || typeof adapter.sendMessage !== 'function') {
        return `Error: 无法获取适配器 ${platform}，无法向 Owner 发送私聊确认。`;
      }
      return askOwnerViaPrivateWithParent(
        this.plugin,
        commMessage,
        recordArgs,
        questionType,
        timeoutMs,
        botMaster,
        adapter,
      );
    }

    return askViaPrompt(this.plugin, commMessage, recordArgs, questionType, timeoutMs);
  }
}
