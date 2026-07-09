/**
 * 子 agent 完成回告：文本 + 工具媒体（generate_image / voice_tts）走统一出站链。
 * 日志 preview 中的 `{image}` 表示本条含 image MessageElement（见 core segment.raw），不是未发送的占位符。
 */
import { parseOutput, type OutputElement } from '@zhin.js/ai';
import type { MessageElement, MessageType, SendOptions } from '@zhin.js/core';
import type { SubagentOrigin } from '../subagent/index.js';
import type { ToolCallRecord } from '../core/tool-calls-user-format.js';
import { mergeToolOutboundElements } from './media-tool-bridge.js';
import { publishOutboundElements } from './media-publisher.js';

export interface SubagentOutboundDelivery {
  /** 面向用户的说明文本（含任务摘要时由调用方组装） */
  text: string;
  toolCalls?: ToolCallRecord[];
  /** 主 Agent deferred auto-continue turn 的完整出站元素（优先于 text+toolCalls） */
  elements?: OutputElement[];
}

export interface DeliverSubagentResultParams {
  origin: SubagentOrigin;
  delivery: SubagentOutboundDelivery;
  send: (options: SendOptions) => Promise<string>;
}

export async function deliverSubagentResult(params: DeliverSubagentResultParams): Promise<void> {
  const { origin, delivery, send } = params;
  const message = origin.message;
  const base: Omit<SendOptions, 'content'> = {
    context: String(message.$adapter),
    endpoint: message.$endpoint,
    id: message.$channel?.id ?? message.$sender.id,
    type: (message.$channel?.type ?? 'private') as MessageType,
  };

  const elements = delivery.elements?.length
    ? delivery.elements
    : mergeToolOutboundElements(
      parseOutput(delivery.text),
      delivery.toolCalls ?? [],
    );
  const segments = await publishOutboundElements(elements, String(message.$adapter));
  if (!segments.length) {
    await send({ ...base, content: delivery.text });
    return;
  }

  const isMedia = (s: MessageElement) =>
    s.type === 'image' || s.type === 'video' || s.type === 'record' || s.type === 'file';
  const mediaSegs = segments.filter(isMedia);
  const textSegs = segments.filter(s => !isMedia(s));

  for (const seg of mediaSegs) {
    await send({ ...base, content: seg });
  }
  if (textSegs.length > 0) {
    await send({
      ...base,
      content: textSegs.length === 1 ? textSegs[0]! : textSegs,
    });
  }
}
