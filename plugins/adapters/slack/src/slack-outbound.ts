/**
 * Slack outbound — chat.postMessage + Block Kit + files.uploadV2
 */
import { createEndpointOperation, type EndpointOperation } from 'zhin.js/adapter';
import type { Logger } from '@zhin.js/logger';
import type { WebClient } from '@slack/web-api';
import { markdownToMrkdwn, mrkdwnToPlainFallback, splitMrkdwnText } from './markdown-to-mrkdwn.js';
import { formatOutboundWire, keyboardToBlockKitBlocks, type SlackBlock } from './protocol.js';

export interface SlackOutboundResult {
  ts: string;
}

export interface SlackSendOptions {
  channel: string;
  threadTs?: string;
}

export interface SlackChatClient {
  chat: Pick<WebClient['chat'], 'postMessage' | 'update'>;
  filesUploadV2?: WebClient['filesUploadV2'];
}

const SLACK_MAX_BLOCKS_PER_MESSAGE = 48;

export interface SlackContentRequest extends SlackSendOptions {
  readonly content: unknown;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
}
export interface SlackEditRequest {
  readonly channel: string;
  readonly ts: string;
  readonly content: unknown;
  readonly signal?: AbortSignal;
}
export async function sendSlackContent(
  client: SlackChatClient,
  { content, logger, signal, ...opts }: SlackContentRequest,
): Promise<SlackOutboundResult> {
  const operation = createEndpointOperation({ signal });
  const wire = formatOutboundWire(content);
  const threadTs = opts.threadTs ?? wire.replyTo;
  const blocks = [...wire.blocks];
  const textDelivery = applyTextMrkdwnBlocks(wire.text, blocks);

  for (const pf of wire.files) {
    try {
      await uploadFile(client, { channel: opts.channel, file: pf, threadTs, operation });
    } catch (e) {
      logger.error('Failed to upload file:', e);
      throw e;
    }
  }

  return postSlackMessage(client, {
    channel: opts.channel,
    threadTs,
    operation,
    blocks,
    attachments: wire.attachments,
    fallbackText: textDelivery.fallbackText,
  });
}

export async function editSlackContent(
  client: SlackChatClient,
  { channel, ts, content, signal }: SlackEditRequest,
): Promise<void> {
  const wire = formatOutboundWire(content);
  const blocks = [...wire.blocks];
  const textDelivery = applyTextMrkdwnBlocks(wire.text, blocks);
  const payloadBlocks = blocks.slice(0, SLACK_MAX_BLOCKS_PER_MESSAGE);

  const updateOpts: { channel: string; ts: string; text: string; blocks?: SlackBlock[] } = {
    channel,
    ts,
    text: textDelivery.fallbackText || ' ',
  };
  if (payloadBlocks.length > 0) updateOpts.blocks = payloadBlocks;
  await createEndpointOperation({ signal }).run(() => client.chat.update(updateOpts));
}

function applyTextMrkdwnBlocks(
  textContent: string,
  blocks: SlackBlock[],
): { fallbackText: string } {
  const trimmed = textContent.trim();
  if (!trimmed) return { fallbackText: '' };

  const mrkdwn = markdownToMrkdwn(trimmed);
  const sections = splitMrkdwnText(mrkdwn).map((chunk) => ({
    type: 'section',
    text: { type: 'mrkdwn', text: chunk },
  }));

  if (blocks.length > 0) {
    blocks.unshift(...sections);
    return { fallbackText: '' };
  }
  blocks.push(...sections);
  return { fallbackText: mrkdwnToPlainFallback(mrkdwn) };
}

async function postSlackMessage(
  client: SlackChatClient,
  opts: {
    channel: string;
    threadTs?: string;
    operation: EndpointOperation;
    blocks: SlackBlock[];
    attachments: Record<string, unknown>[];
    fallbackText: string;
  },
): Promise<SlackOutboundResult> {
  const { channel, blocks, attachments, fallbackText, operation } = opts;
  let threadTs = opts.threadTs;
  let firstTs = '';

  if (blocks.length === 0) {
    const result = await operation.run(() => client.chat.postMessage({
      channel,
      text: fallbackText || 'Message',
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    }));
    return { ts: requireMessageTimestamp(result) };
  }

  for (let offset = 0; offset < blocks.length; offset += SLACK_MAX_BLOCKS_PER_MESSAGE) {
    const chunk = blocks.slice(offset, offset + SLACK_MAX_BLOCKS_PER_MESSAGE);
    const result = await operation.run(() => client.chat.postMessage({
      channel,
      text: offset === 0 ? (fallbackText || ' ') : ' ',
      blocks: chunk,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(offset === 0 && attachments.length > 0 ? { attachments } : {}),
    }));
    const ts = requireMessageTimestamp(result);
    if (!firstTs) firstTs = ts;
    if (!threadTs) threadTs = ts;
  }

  return { ts: firstTs };
}

function requireMessageTimestamp(result: { ts?: string } | null | undefined): string {
  if (typeof result?.ts !== 'string' || !result.ts.trim()) {
    throw new Error('Slack chat.postMessage returned no valid ts; delivery is unconfirmed');
  }
  return result.ts;
}

async function uploadFile(
  client: SlackChatClient,
  { channel, file, threadTs, operation }: {
    readonly channel: string;
    readonly file: { buffer?: Buffer; url?: string; path?: string; name?: string };
    readonly threadTs?: string;
    readonly operation: EndpointOperation;
  },
): Promise<void> {
  const upload = client.filesUploadV2;
  if (!upload) throw new Error('Slack client does not support file uploads');
  const { path, url } = file;
  let buffer = file.buffer;
  if (!buffer && path) {
    const { readFile } = await operation.prepare(() => import('node:fs/promises'));
    buffer = await operation.prepare(() => readFile(path));
  }
  if (!buffer && url) {
    const res = await operation.prepare(() => fetch(url, { signal: operation.signal }));
    if (!res.ok) throw new Error(`fetch ${file.url}: ${res.status}`);
    buffer = Buffer.from(await operation.prepare(() => res.arrayBuffer()));
  }
  if (!buffer) throw new Error('Slack file contains no uploadable content');

  const options: Parameters<typeof upload>[0] = threadTs
    ? { channel_id: channel, file: buffer, filename: file.name ?? 'file', thread_ts: threadTs }
    : { channel_id: channel, file: buffer, filename: file.name ?? 'file' };
  await operation.run(() => upload.call(client, options));
}

export { keyboardToBlockKitBlocks };
