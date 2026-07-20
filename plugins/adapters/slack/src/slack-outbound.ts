/**
 * Slack outbound — chat.postMessage + Block Kit + files.uploadV2
 */
import type { Logger } from '@zhin.js/logger';
import { markdownToMrkdwn, mrkdwnToPlainFallback, splitMrkdwnText } from './markdown-to-mrkdwn.js';
import { formatOutboundWire, keyboardToBlockKitBlocks } from './protocol.js';

export interface SlackOutboundResult {
  ts: string;
}

export interface SlackSendOptions {
  channel: string;
  threadTs?: string;
}

export interface SlackChatClient {
  chat: {
    postMessage(opts: Record<string, unknown>): Promise<{ ts?: string }>;
    update(opts: Record<string, unknown>): Promise<unknown>;
  };
  filesUploadV2?(opts: Record<string, unknown>): Promise<unknown>;
}

const SLACK_MAX_BLOCKS_PER_MESSAGE = 48;

export async function sendSlackContent(
  client: SlackChatClient,
  content: unknown,
  opts: SlackSendOptions,
  logger: Logger,
): Promise<SlackOutboundResult> {
  const wire = formatOutboundWire(content);
  const blocks = [...wire.blocks];
  const textDelivery = applyTextMrkdwnBlocks(wire.text, blocks);

  for (const pf of wire.files) {
    try {
      await uploadFile(client, opts.channel, pf, opts.threadTs, logger);
    } catch (e) {
      logger.error('Failed to upload file:', e);
    }
  }

  return postSlackMessage(client, {
    channel: opts.channel,
    threadTs: opts.threadTs,
    blocks,
    attachments: wire.attachments,
    fallbackText: textDelivery.fallbackText,
  });
}

export async function editSlackContent(
  client: SlackChatClient,
  channel: string,
  ts: string,
  content: unknown,
): Promise<void> {
  const wire = formatOutboundWire(content);
  const blocks = [...wire.blocks];
  const textDelivery = applyTextMrkdwnBlocks(wire.text, blocks);
  const payloadBlocks = blocks.slice(0, SLACK_MAX_BLOCKS_PER_MESSAGE);

  const updateOpts: Record<string, unknown> = {
    channel,
    ts,
    text: textDelivery.fallbackText || ' ',
  };
  if (payloadBlocks.length > 0) updateOpts.blocks = payloadBlocks;
  await client.chat.update(updateOpts);
}

function applyTextMrkdwnBlocks(
  textContent: string,
  blocks: Record<string, unknown>[],
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
    blocks: Record<string, unknown>[];
    attachments: Record<string, unknown>[];
    fallbackText: string;
  },
): Promise<SlackOutboundResult> {
  const { channel, blocks, attachments, fallbackText } = opts;
  let threadTs = opts.threadTs;
  let firstTs = '';

  if (blocks.length === 0) {
    const result = await client.chat.postMessage({
      channel,
      text: fallbackText || 'Message',
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
    });
    return { ts: result.ts ?? '' };
  }

  for (let offset = 0; offset < blocks.length; offset += SLACK_MAX_BLOCKS_PER_MESSAGE) {
    const chunk = blocks.slice(offset, offset + SLACK_MAX_BLOCKS_PER_MESSAGE);
    const result = await client.chat.postMessage({
      channel,
      text: offset === 0 ? (fallbackText || ' ') : ' ',
      blocks: chunk,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(offset === 0 && attachments.length > 0 ? { attachments } : {}),
    });
    const ts = result.ts ?? '';
    if (!firstTs) firstTs = ts;
    if (!threadTs) threadTs = ts;
  }

  return { ts: firstTs };
}

async function uploadFile(
  client: SlackChatClient,
  channel: string,
  file: { buffer?: Buffer; url?: string; path?: string; name?: string },
  threadTs?: string,
  logger?: Logger,
): Promise<void> {
  if (!client.filesUploadV2) return;
  try {
    let buffer = file.buffer;
    if (!buffer && file.path) {
      const { readFile } = await import('node:fs/promises');
      buffer = await readFile(file.path);
    }
    if (!buffer && file.url) {
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`fetch ${file.url}: ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
    }
    if (!buffer) return;

    await client.filesUploadV2(
      threadTs
        ? { channel_id: channel, file: buffer, filename: file.name ?? 'file', thread_ts: threadTs }
        : { channel_id: channel, file: buffer, filename: file.name ?? 'file' },
    );
  } catch (e) {
    logger?.error('File upload failed:', e);
  }
}

export { keyboardToBlockKitBlocks };
