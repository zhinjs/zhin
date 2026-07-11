/**
 * Slack 出站消息构造 — mrkdwn + Block Kit + files.uploadV2
 */
import type { WebClient } from '@slack/web-api';
import type { MessageSegment, SendContent } from 'zhin.js';
import type { Logger } from '@zhin.js/logger';
import { markdownToMrkdwn, mrkdwnToPlainFallback, splitMrkdwnText } from './markdown-to-mrkdwn.js';

export interface SlackOutboundResult {
  ts: string;
}

export interface SlackSendOptions {
  channel: string;
  threadTs?: string;
}

const SLACK_MAX_BLOCKS_PER_MESSAGE = 48;

export async function sendSlackContent(
  client: WebClient,
  content: SendContent,
  opts: SlackSendOptions,
  logger: Logger,
): Promise<SlackOutboundResult> {
  const segments = normalizeContent(content);
  let textContent = '';
  const blocks: Record<string, unknown>[] = [];
  const attachments: Record<string, unknown>[] = [];
  const pendingFiles: Array<{ buffer?: Buffer; url?: string; path?: string; name?: string }> = [];

  for (const seg of segments) {
    if (typeof seg === 'string') {
      textContent += seg;
      continue;
    }
    const { type, data } = seg as MessageSegment;
    switch (type) {
      case 'text':
        textContent += data.text ?? '';
        break;
      case 'at':
      case 'mention':
        textContent += `<@${data.id ?? data.target}>`;
        break;
      case 'channel_mention':
        textContent += `<#${data.id}>`;
        break;
      case 'link':
        if (data.text && data.text !== data.url) {
          textContent += `<${data.url}|${data.text}>`;
        } else {
          textContent += `<${data.url}>`;
        }
        break;
      case 'image':
        if (data.url) {
          attachments.push({ image_url: data.url, title: data.name ?? data.title ?? '' });
        } else if (data.media) {
          pendingFiles.push(resolveMediaToFile(data.media, data.alt ?? 'image'));
        }
        break;
      case 'audio':
      case 'video':
      case 'file':
        if (data.media) {
          pendingFiles.push(resolveMediaToFile(data.media, data.name ?? type));
        } else if (data.file || data.url) {
          pendingFiles.push({ path: data.file, url: data.url, name: data.name ?? type });
        }
        break;
      case 'keyboard':
        blocks.push(...keyboardToBlockKitBlocks(data));
        break;
      default:
        textContent += data.text ?? `[${type}]`;
    }
  }

  const textDelivery = applyTextMrkdwnBlocks(textContent, blocks);

  for (const pf of pendingFiles) {
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
    attachments,
    fallbackText: textDelivery.fallbackText,
  });
}

export async function editSlackContent(
  client: WebClient,
  channel: string,
  ts: string,
  content: SendContent,
): Promise<void> {
  const segments = normalizeContent(content);
  let textContent = '';
  const blocks: Record<string, unknown>[] = [];

  for (const seg of segments) {
    if (typeof seg === 'string') { textContent += seg; continue; }
    const { type, data } = seg as MessageSegment;
    switch (type) {
      case 'text': textContent += data.text ?? ''; break;
      case 'at': case 'mention': textContent += `<@${data.id ?? data.target}>`; break;
      case 'channel_mention': textContent += `<#${data.id}>`; break;
      case 'link':
        textContent += data.text && data.text !== data.url ? `<${data.url}|${data.text}>` : `<${data.url}>`;
        break;
      case 'keyboard':
        blocks.push(...keyboardToBlockKitBlocks(data));
        break;
      default: textContent += data.text ?? `[${type}]`;
    }
  }

  const textDelivery = applyTextMrkdwnBlocks(textContent, blocks);
  const payloadBlocks = blocks.slice(0, SLACK_MAX_BLOCKS_PER_MESSAGE);

  const updateOpts: Record<string, unknown> = {
    channel,
    ts,
    text: textDelivery.fallbackText || ' ',
  };
  if (payloadBlocks.length > 0) updateOpts.blocks = payloadBlocks;
  await client.chat.update(updateOpts as any);
}

function normalizeContent(content: SendContent): Array<string | MessageSegment> {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [content as MessageSegment];
  return content as Array<string | MessageSegment>;
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
  client: WebClient,
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
    } as any);
    return { ts: (result as any).ts ?? '' };
  }

  for (let offset = 0; offset < blocks.length; offset += SLACK_MAX_BLOCKS_PER_MESSAGE) {
    const chunk = blocks.slice(offset, offset + SLACK_MAX_BLOCKS_PER_MESSAGE);
    const result = await client.chat.postMessage({
      channel,
      text: offset === 0 ? (fallbackText || ' ') : ' ',
      blocks: chunk,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(offset === 0 && attachments.length > 0 ? { attachments } : {}),
    } as any);
    const ts = (result as any).ts ?? '';
    if (!firstTs) firstTs = ts;
    if (!threadTs) threadTs = ts;
  }

  return { ts: firstTs };
}

function resolveMediaToFile(
  media: { kind: string; value: string; mime_type?: string },
  name: string,
): { buffer?: Buffer; url?: string; name: string } {
  if (media.kind === 'base64') {
    return { buffer: Buffer.from(media.value, 'base64'), name };
  }
  if (media.kind === 'url') {
    return { url: media.value, name };
  }
  return { url: media.value, name };
}

/** 每行 keyboard → 独立 actions block（Slack 每 block 最多 5 个按钮） */
export function keyboardToBlockKitBlocks(data: Record<string, unknown>): Record<string, unknown>[] {
  const rows = data.rows as Array<Array<Record<string, unknown>>> | undefined;
  if (!rows?.length) return [];

  const blocks: Record<string, unknown>[] = [];
  for (const row of rows) {
    const elements = row.slice(0, 5).map((btn, index) => ({
      type: 'button',
      text: { type: 'plain_text', text: String(btn.label ?? btn.text ?? 'button').slice(0, 75) },
      action_id: String(btn.id ?? btn.action_id ?? `btn_${blocks.length}_${index}`),
      ...(btn.value != null ? { value: String(btn.value) } : {}),
      ...(btn.style === 'primary' ? { style: 'primary' } : {}),
      ...(btn.style === 'danger' ? { style: 'danger' } : {}),
    }));
    if (elements.length > 0) {
      blocks.push({ type: 'actions', elements });
    }
  }
  return blocks;
}

async function uploadFile(
  client: WebClient,
  channel: string,
  file: { buffer?: Buffer; url?: string; path?: string; name?: string },
  threadTs?: string,
  logger?: Logger,
): Promise<void> {
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
