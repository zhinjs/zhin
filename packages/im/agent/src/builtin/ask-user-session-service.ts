/**
 * ask_user 常驻会话服务 — 单轨 middleware、排队、命令 bypass、Prompt/私聊统一。
 */
import {
  Prompt,
  type Adapter,
  type Message,
  type MessageMiddleware,
  type Plugin,
  type SendOptions,
} from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { notifyGroupOwnerAskUserResolved, buildGroupAskUserFollowUp } from '../collaboration/ask-user-bridge.js';
import {
  buildSensitiveOwnerQuestionText,
  formatOwnerResponse,
} from './ask-user-tool.js';

export type AskUserSessionKind = 'prompt' | 'sensitive_dm';

export interface AskUserOpenSpec {
  sessionId: string;
  kind: AskUserSessionKind;
  message: Message;
  questionType: string;
  args: Record<string, unknown>;
  timeoutMs: number;
  botMaster?: string;
  adapter?: Adapter;
  groupOrigin?: Message;
}

interface PendingEntry {
  spec: AskUserOpenSpec;
  resolve: (value: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface OwnerQueue {
  active?: PendingEntry;
  waiting: PendingEntry[];
}

function ownerKey(endpointId: string, masterId: string): string {
  return `${endpointId}:${masterId}`;
}

function promptKey(message: Message): string {
  return `${message.$adapter}-${message.$endpoint}-${message.$channel?.type}:${message.$channel?.id}-${message.$sender?.id}`;
}

function isSlashCommand(message: Message): boolean {
  const raw = String(message.$raw ?? '').trim();
  return raw.startsWith('/');
}

let serviceInstance: AskUserSessionService | undefined;

export class AskUserSessionService {
  private readonly ownerQueues = new Map<string, OwnerQueue>();
  private readonly promptWaits = new Map<string, PendingEntry>();
  private readonly disposeMiddleware: () => void;

  constructor(private readonly plugin: Plugin) {
    this.disposeMiddleware = (plugin.root ?? plugin).addMiddleware(this.middleware.bind(this));
  }

  static install(plugin: Plugin): AskUserSessionService {
    if (!serviceInstance) {
      serviceInstance = new AskUserSessionService(plugin);
    }
    return serviceInstance;
  }

  static resetForTests(): void {
    serviceInstance = undefined;
  }

  static get(): AskUserSessionService | undefined {
    return serviceInstance;
  }

  matchInbound(
    message: Message,
    root?: Plugin,
  ): 'consume' | 'bypass' | 'ignore' {
    if (isSlashCommand(message) && this.hasPendingForMessage(message, root)) {
      return 'bypass';
    }
    if (this.tryMatchPrompt(message)) return 'consume';
    if (this.tryMatchSensitiveDm(message, root)) return 'consume';
    return 'ignore';
  }

  isPendingReply(message: Message, root?: Plugin): boolean {
    return this.matchInbound(message, root) === 'consume';
  }

  async open(spec: AskUserOpenSpec): Promise<string> {
    if (spec.kind === 'prompt') {
      return this.openPrompt(spec);
    }
    return this.openSensitiveDm(spec);
  }

  private hasPendingForMessage(message: Message, root?: Plugin): boolean {
    if (this.promptWaits.has(promptKey(message))) return true;

    const endpointId = String(message.$endpoint ?? '');
    const senderId = String(message.$sender?.id ?? '');
    if (endpointId && senderId) {
      const direct = this.ownerQueues.get(ownerKey(endpointId, senderId));
      if (direct?.active || direct?.waiting.length) return true;
    }

    const ids = this.resolveEndpointMaster(message, root);
    if (!ids) return false;
    const queue = this.ownerQueues.get(ownerKey(ids.endpointId, ids.masterId));
    return Boolean(queue?.active || queue?.waiting.length);
  }

  private tryMatchPrompt(message: Message): boolean {
    return this.promptWaits.has(promptKey(message));
  }

  private tryMatchSensitiveDm(message: Message, root?: Plugin): boolean {
    if (message.$channel?.type !== 'private') return false;
    const senderId = String(message.$sender?.id ?? '');
    const endpointId = String(message.$endpoint ?? '');
    if (!senderId || !endpointId) return false;

    const direct = this.ownerQueues.get(ownerKey(endpointId, senderId));
    if (direct?.active) return true;

    const ids = this.resolveEndpointMaster(message, root);
    if (!ids || senderId !== ids.masterId) return false;
    return Boolean(this.ownerQueues.get(ownerKey(ids.endpointId, ids.masterId))?.active);
  }

  private async openPrompt(spec: AskUserOpenSpec): Promise<string> {
    const host = this.plugin.root ?? this.plugin;
    const prompt = new Prompt(host, spec.message);
    const questionType = spec.questionType;
    const args = spec.args;
    const timeoutMs = spec.timeoutMs;

    try {
      switch (questionType) {
        case 'number': {
          const defaultNum = args.default_value != null ? Number(args.default_value) : undefined;
          const result = await prompt.number(
            String(args.question ?? ''),
            timeoutMs,
            defaultNum,
            '输入超时，已取消',
          );
          return String(result);
        }
        case 'confirm': {
          const result = await prompt.confirm(
            String(args.question ?? ''),
            'yes',
            timeoutMs,
            false,
            '确认超时，已取消',
          );
          return result ? 'yes' : 'no';
        }
        case 'pick': {
          const options = args.options as string[] | undefined;
          if (!options?.length) {
            return 'Error: type=pick 时必须提供 options 选项列表';
          }
          const pickOptions = options.map((o) => ({ label: o, value: o }));
          const result = await prompt.pick(String(args.question ?? ''), {
            type: 'text' as const,
            options: pickOptions,
            timeout: timeoutMs,
          }, '选择超时，已取消');
          return String(result);
        }
        case 'text':
        default: {
          const result = await prompt.text(
            String(args.question ?? ''),
            timeoutMs,
            String(args.default_value ?? ''),
            '输入超时，已取消',
          );
          return result;
        }
      }
    } catch (e: unknown) {
      return `Owner 未响应或输入错误: ${errMsg(e)}`;
    }
  }

  private openSensitiveDm(spec: AskUserOpenSpec): Promise<string> {
    const masterId = String(spec.botMaster ?? '');
    const endpointId = String(spec.message.$endpoint ?? '');
    const key = ownerKey(endpointId, masterId);

    return new Promise<string>((resolve) => {
      const entry: PendingEntry = {
        spec,
        resolve,
        timer: setTimeout(() => {}, spec.timeoutMs),
      };

      entry.timer = setTimeout(() => {
        this.finishOwnerEntry(key, entry, this.timeoutFallback(spec));
      }, spec.timeoutMs);

      const queue = this.ownerQueues.get(key) ?? { waiting: [] };
      if (queue.active) {
        queue.waiting.push(entry);
        this.ownerQueues.set(key, queue);
        return;
      }
      queue.active = entry;
      this.ownerQueues.set(key, queue);
      void this.sendSensitiveQuestion(spec);
    });
  }

  private async sendSensitiveQuestion(spec: AskUserOpenSpec): Promise<void> {
    const { message, args, questionType, botMaster, adapter } = spec;
    if (!botMaster || !adapter) return;

    const sceneId = String(message.$channel?.id ?? '');
    const parentType = message.$channel?.type === 'channel' ? 'channel' as const : 'group' as const;
    const questionText = buildSensitiveOwnerQuestionText(
      message,
      String(args.question ?? ''),
      questionType,
      args.options as string[] | undefined,
    );

    try {
      await adapter.sendMessage({
        context: message.$adapter!,
        endpoint: message.$endpoint!,
        id: botMaster,
        type: 'private',
        parent: { type: parentType, id: sceneId },
        content: questionText,
      } satisfies SendOptions);
    } catch (e: unknown) {
      const key = ownerKey(String(message.$endpoint), botMaster);
      const queue = this.ownerQueues.get(key);
      const active = queue?.active;
      if (active?.spec.sessionId === spec.sessionId) {
        this.finishOwnerEntry(key, active, `Error: 无法向 Owner 发送私聊消息: ${errMsg(e)}`);
      }
    }
  }

  private timeoutFallback(spec: AskUserOpenSpec): string {
    if (spec.args.default_value != null) return String(spec.args.default_value);
    return 'Owner 未在规定时间内响应，操作已取消。';
  }

  private finishOwnerEntry(key: string, entry: PendingEntry, answer: string): void {
    clearTimeout(entry.timer);
    const queue = this.ownerQueues.get(key);
    if (!queue || queue.active !== entry) return;

    queue.active = undefined;
    const groupOrigin = entry.spec.groupOrigin ?? entry.spec.message;
    void notifyGroupOwnerAskUserResolved(groupOrigin, answer).catch(() => {});
    entry.resolve(answer);

    const next = queue.waiting.shift();
    if (next) {
      queue.active = next;
      this.ownerQueues.set(key, queue);
      void this.sendSensitiveQuestion(next.spec);
      return;
    }
    this.ownerQueues.delete(key);
  }

  private resolveEndpointMaster(
    message: Message,
    root?: Plugin,
  ): { endpointId: string; masterId: string } | undefined {
    const endpointId = String(message.$endpoint ?? '');
    if (!endpointId || !root) return undefined;
    try {
      const adapter = root.inject(message.$adapter) as
        | { endpoints?: Map<string, { $config?: { master?: string } }> }
        | undefined;
      const master = adapter?.endpoints?.get(endpointId)?.$config?.master;
      if (master == null) return undefined;
      return { endpointId, masterId: String(master) };
    } catch {
      return undefined;
    }
  }

  private middleware: MessageMiddleware = async (message, next) => {
    const match = this.matchInbound(message, this.plugin.root ?? this.plugin);
    if (match === 'ignore') return next();
    if (match === 'bypass') return next();

    const promptWait = this.promptWaits.get(promptKey(message));
    if (promptWait) {
      clearTimeout(promptWait.timer);
      this.promptWaits.delete(promptKey(message));
      const raw = String(message.$raw ?? '');
      promptWait.resolve(formatOwnerResponse(raw, promptWait.spec.questionType, promptWait.spec.args));
      return;
    }

    const senderId = String(message.$sender?.id ?? '');
    const endpointId = String(message.$endpoint ?? '');
    let key = ownerKey(endpointId, senderId);
    let queue = this.ownerQueues.get(key);
    if (!queue?.active) {
      const ids = this.resolveEndpointMaster(message, this.plugin.root ?? this.plugin);
      if (ids) {
        key = ownerKey(ids.endpointId, ids.masterId);
        queue = this.ownerQueues.get(key);
      }
    }
    const active = queue?.active;
    if (!active) return next();

    const raw = String(message.$raw ?? '');
    const formatted = formatOwnerResponse(raw, active.spec.questionType, active.spec.args);
    const answer = active.spec.groupOrigin
      ? buildGroupAskUserFollowUp(active.spec.groupOrigin, formatted)
      : formatted;
    this.finishOwnerEntry(key, active, answer);
  };
}
