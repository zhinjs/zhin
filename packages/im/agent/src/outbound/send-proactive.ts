/**
 * Proactive 出站统一入口 — 经 dispatcher ALS 走 outbound polish / before.sendMessage。
 */
import {
  createSyntheticMessage,
  sceneRefToSendOptions,
  type IMSceneRef,
  type Message,
  type Plugin,
  type SendContent,
  type SendOptions,
} from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';

export type ProactiveSendSource =
  | 'scheduled'
  | 'notification'
  | 'collaboration'
  | 'ask_user'
  | 'subagent'
  | 'host';

export interface ProactiveSendContext {
  scene: IMSceneRef;
  source: ProactiveSendSource;
  originMessage?: Message;
  quoteMessageId?: string;
}

export interface ProactiveOutboundDeps {
  plugin: Plugin;
  resolveAdapter: (platform: string) => { sendMessage: (opts: SendOptions) => Promise<string> } | undefined;
}

export interface ProactiveOutboundService {
  send(ctx: ProactiveSendContext, content: SendContent): Promise<string>;
  sendElements(ctx: ProactiveSendContext, elements: OutputElement[]): Promise<string[]>;
}

function syntheticFromScene(scene: IMSceneRef): Message {
  return createSyntheticMessage({
    adapter: scene.platform,
    endpoint: scene.endpointId,
    sender: { id: scene.senderId ?? 'system', name: 'system', isMaster: true },
    channel: {
      type: scene.kind,
      id: scene.sceneId,
      ...(scene.parent
        ? { parent: { type: scene.parent.kind, id: scene.parent.sceneId } }
        : {}),
    },
  });
}

export function createProactiveOutboundService(
  deps: ProactiveOutboundDeps,
): ProactiveOutboundService {
  const root = deps.plugin.root ?? deps.plugin;

  async function sendWithPolish(
    ctx: ProactiveSendContext,
    sendOptions: SendOptions,
  ): Promise<string> {
    const adapter = deps.resolveAdapter(ctx.scene.platform);
    if (!adapter) {
      throw new Error(`Adapter not found: ${ctx.scene.platform}`);
    }

    const anchor = ctx.originMessage ?? syntheticFromScene(ctx.scene);
    const dispatcher = root.inject('dispatcher') as
      | {
          runWithOutboundPolish?: (
            store: { message: Message; trigger: 'proactive'; proactiveSource: ProactiveSendSource },
            fn: () => Promise<string>,
          ) => Promise<string>;
        }
      | undefined;

    if (dispatcher?.runWithOutboundPolish) {
      return dispatcher.runWithOutboundPolish(
        { message: anchor, trigger: 'proactive', proactiveSource: ctx.source },
        () => adapter.sendMessage(sendOptions),
      );
    }
    return adapter.sendMessage(sendOptions);
  }

  return {
    async send(ctx, content) {
      const opts = sceneRefToSendOptions(
        {
          channel: 'im',
          scene: ctx.scene,
          ...(ctx.quoteMessageId ? { quoteId: ctx.quoteMessageId } : {}),
        },
        content,
      );
      return sendWithPolish(ctx, opts);
    },

    async sendElements(ctx, elements) {
      const { publishOutboundElements } = await import('../media/media-publisher.js');
      const segments = await publishOutboundElements(elements, ctx.scene.platform);
      const ids: string[] = [];
      for (const seg of segments) {
        const id = await this.send(ctx, seg);
        ids.push(id);
      }
      return ids;
    },
  };
}
