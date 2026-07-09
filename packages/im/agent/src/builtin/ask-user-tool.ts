/**
 * ask_user — 默认在当前会话（群/频道/私聊）Prompt 提问；敏感确认走私聊 master（群来源带 parent）。
 */
import {
  type Plugin,
  type Message,
  type Tool,
  type ToolParametersSchema,
  type ToolResult,
  type Adapter,
} from '@zhin.js/core';
import { randomUUID } from 'node:crypto';
import { BuiltinBaseTool } from './builtin-base-tool.js';
import { shouldBlockDelegationAskUser } from '../collaboration/ask-user-bridge.js';
import { AskUserSessionService } from './ask-user-session-service.js';
import { ensureAskUserSessionService } from './ask-user-session.js';

// ============================================================================
// Prompt / Owner 回复格式化
// ============================================================================

export async function askViaPrompt(
  plugin: Plugin,
  message: Message,
  args: Record<string, unknown>,
  questionType: string,
  timeoutMs: number,
): Promise<string> {
  const service = ensureAskUserSessionService(plugin);
  return service.open({
    sessionId: randomUUID(),
    kind: 'prompt',
    message,
    questionType,
    args,
    timeoutMs,
  });
}

export function formatOwnerResponse(raw: string, questionType: string, args: Record<string, unknown>): string {
  switch (questionType) {
    case 'confirm':
      return raw.trim().toLowerCase() === 'yes' ? 'yes' : 'no';
    case 'number':
      return String(Number(raw) || 0);
    case 'pick': {
      const idx = Number(raw.trim());
      const options = (args.options as string[]) || [];
      if (idx >= 1 && idx <= options.length) return options[idx - 1]!;
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

export async function askOwnerViaPrivateWithParent(
  plugin: Plugin,
  commMessage: Message,
  args: Record<string, unknown>,
  questionType: string,
  timeoutMs: number,
  botMaster: string,
  adapter: Adapter,
): Promise<string> {
  const service = ensureAskUserSessionService(plugin);
  return service.open({
    sessionId: randomUUID(),
    kind: 'sensitive_dm',
    message: commMessage,
    questionType,
    args,
    timeoutMs,
    botMaster,
    adapter,
    groupOrigin: commMessage,
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

export function createAskUserTool(plugin: Plugin): Tool {
  ensureAskUserSessionService(plugin);
  return new AskUserBuiltinTool(plugin).toTool();
}

export class AskUserBuiltinTool extends BuiltinBaseTool {
  readonly name = 'ask_user';
  readonly description =
    'Ask the user and wait for a reply. Default: prompt in the current session (group/channel/private) to the triggering user. Set sensitive=true only to confirm with the Endpoint Owner via private DM (group origin uses parent; no group-visible trace). Owner private chat: /approve always bash, /approve rule <regex>, /approve list, /approve revoke. write_file / edit_file / web_fetch hard-orchestration still requires per-action Owner confirm.';
  readonly parameters = ASK_USER_PARAMETERS;
  readonly kind = 'interaction';
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
    const recordArgs = args;
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
