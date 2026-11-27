/**
 * Slack outbound — chat.postMessage + Block Kit + files.uploadV2
 */
import { createEndpointOperation, type EndpointOperation } from 'zhin.js/adapter';
import type { Logger } from '@zhin.js/logger';
import { fetchOutboundMedia, isOutboundMediaRefused, outboundMediaNotice, type OutboundMediaFetcher } from '@zhin.js/core';
import type { WebClient } from '@slack/web-api';
import { markdownToMrkdwn, mrkdwnToPlainFallback, splitMrkdwnText } from './markdown-to-mrkdwn.js';
import { formatOutboundWire, keyboardToBlockKitBlocks, type SlackBlock } from './protocol.js';
import { createMessages, type Locale } from 'zhin.js/i18n';

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
  /** Downloads file URLs on this host before `files.uploadV2`; defaults to core `fetchOutboundMedia` (tests inject one). */
  readonly fetchMedia?: OutboundMediaFetcher;
}
export interface SlackEditRequest {
  readonly channel: string;
  readonly ts: string;
  readonly content: unknown;
  readonly signal?: AbortSignal;
}
export async function sendSlackContent(
  client: SlackChatClient,
  { content, logger, signal, fetchMedia = fetchOutboundMedia, ...opts }: SlackContentRequest,
): Promise<SlackOutboundResult> {
  const operation = createEndpointOperation({ signal });
  const wire = formatOutboundWire(content);
  const threadTs = opts.threadTs ?? wire.replyTo;
  const blocks = [...wire.blocks];
  const textDelivery = applyTextMrkdwnBlocks(wire.text, blocks);
  const notices: string[] = [];

  for (const pf of wire.files) {
    try {
      await uploadFile(client, { channel: opts.channel, file: pf, threadTs, operation, fetchMedia });
    } catch (e) {
      // #1250 第 46 批：URL 被本机抓取策略拒绝 → 说明文字，消息照常发出。
      if (isOutboundMediaRefused(e)) {
        notices.push(outboundMediaNotice('file'));
        continue;
      }
      logger.error('Failed to upload file:', e);
      throw e;
    }
  }
  for (const notice of notices) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: notice } } as SlackBlock);

  return postSlackMessage(client, {
    channel: opts.channel,
    threadTs,
    operation,
    blocks,
    attachments: wire.attachments,
    fallbackText: [textDelivery.fallbackText, ...notices].filter(Boolean).join('\n'),
  });
}

export async function editSlackContent(
  client: SlackChatClient,
  { channel, ts, content, signal }: SlackEditRequest,
): Promise<void> {
  const wire = formatOutboundWire(content);
  const blocks = [...wire.blocks];
  const textDelivery = applyTextMrkdwnBlocks(wire.text, blocks);
  // #1250 b113: one message holds at most SLACK_MAX_BLOCKS_PER_MESSAGE blocks. A long card used to lose
  // its buttons (the last blocks) here; the text is cut instead, a notice says so, and the buttons stay.
  // Only this one message is edited: the later parts of a card sent as several messages
  // (`splitBlocksIntoMessages`) are not touched, so an edit applies to the first part only.
  const payloadBlocks = fitEditBlocks(blocks);

  const updateOpts: { channel: string; ts: string; text: string; blocks?: SlackBlock[] } = {
    channel,
    ts,
    text: textDelivery.fallbackText || notificationText(payloadBlocks),
  };
  if (payloadBlocks.length > 0) updateOpts.blocks = payloadBlocks;
  await createEndpointOperation({ signal }).run(() => client.chat.update(updateOpts));
}

const outboundMessages = createMessages({
  truncated: { 'zh-CN': '[内容过长，已截断]', en: '[Content too long, truncated]' },
});

/**
 * The blocks of one edited message (#1250 b113): all of them when they fit; otherwise the text is cut,
 * a notice section marks the cut, and every button row stays last. More button rows than one message
 * holds (Core's cards never produce this) keep the first SLACK_MAX_BLOCKS_PER_MESSAGE blocks.
 */
function fitEditBlocks(blocks: readonly SlackBlock[], locale?: Locale): SlackBlock[] {
  const max = SLACK_MAX_BLOCKS_PER_MESSAGE;
  if (blocks.length <= max) return [...blocks];
  const actions = blocks.filter(isActionsBlock);
  // Room for the notice and at least one block of text next to the buttons.
  if (actions.length > max - 2) return blocks.slice(0, max);
  const notice = { type: 'section', text: { type: 'mrkdwn', text: outboundMessages(locale, 'truncated') } } as SlackBlock;
  const others = blocks.filter(block => !isActionsBlock(block)).slice(0, max - actions.length - 1);
  return [...others, notice, ...actions];
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

  // #1250 b113: a card with buttons (a confirmation / approval card) keeps every part where it was sent.
  // Threading the later parts under the first one put the buttons into a new thread, and a click there
  // arrives as a message of that thread (another conversation), so it never answered the waiting prompt.
  const interactive = blocks.some(isActionsBlock);
  const chunks = splitBlocksIntoMessages(blocks);
  for (const [index, chunk] of chunks.entries()) {
    const result = await operation.run(() => client.chat.postMessage({
      channel,
      // Each part names its own text in the notification instead of a blank one.
      text: index === 0 && fallbackText ? fallbackText : notificationText(chunk),
      blocks: chunk,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      ...(index === 0 && attachments.length > 0 ? { attachments } : {}),
    }));
    const ts = requireMessageTimestamp(result);
    if (!firstTs) firstTs = ts;
    if (!threadTs && !interactive) threadTs = ts;
  }

  return { ts: firstTs };
}

function isActionsBlock(block: SlackBlock): boolean {
  return (block as { type?: unknown }).type === 'actions';
}

/**
 * Blocks per message (#1250 b113), each part at most SLACK_MAX_BLOCKS_PER_MESSAGE blocks.
 * - Everything fits in one message: the blocks as they are, in their original order.
 * - Otherwise the buttons (`actions` blocks) all go on the last message, together with at least the end
 *   of the text before them, never on a message of their own and never split from each other: the last
 *   message holds the text's last `max - actions` blocks, the text before it is cut into full messages.
 * - More button rows than fit next to any text (`actions >= max`; Core's cards never produce this):
 *   plain consecutive parts in the original order.
 */
export function splitBlocksIntoMessages(blocks: readonly SlackBlock[]): SlackBlock[][] {
  const max = SLACK_MAX_BLOCKS_PER_MESSAGE;
  const naive = (list: readonly SlackBlock[]) => {
    const chunks: SlackBlock[][] = [];
    for (let offset = 0; offset < list.length; offset += max) chunks.push(list.slice(offset, offset + max));
    return chunks;
  };
  if (blocks.length <= max) return [[...blocks]];
  const actions = blocks.filter(isActionsBlock);
  if (!actions.length) return naive(blocks);
  const room = max - actions.length;
  if (room < 1) return naive(blocks);
  const others = blocks.filter(block => !isActionsBlock(block));
  const tail = others.slice(Math.max(0, others.length - room));
  return [...naive(others.slice(0, others.length - tail.length)), [...tail, ...actions]];
}

/** Longest notification text of one part (Slack shows it in notifications and to screen readers). */
const NOTIFICATION_TEXT_MAX = 300;

/** The plain text of a part's `mrkdwn` sections, cut for the notification; a single space when it has none. */
function notificationText(blocks: readonly SlackBlock[]): string {
  const text = blocks
    .map(block => (block as { type?: unknown; text?: { type?: unknown; text?: unknown } }))
    .filter(block => block.type === 'section' && block.text?.type === 'mrkdwn' && typeof block.text.text === 'string')
    .map(block => mrkdwnToPlainFallback(block.text!.text as string))
    .join('\n')
    .trim();
  if (!text) return ' ';
  const points = Array.from(text);
  return points.length <= NOTIFICATION_TEXT_MAX ? text : `${points.slice(0, NOTIFICATION_TEXT_MAX).join('')}…`;
}

function requireMessageTimestamp(result: { ts?: string } | null | undefined): string {
  if (typeof result?.ts !== 'string' || !result.ts.trim()) {
    throw new Error('Slack chat.postMessage returned no valid ts; delivery is unconfirmed');
  }
  return result.ts;
}

async function uploadFile(
  client: SlackChatClient,
  { channel, file, threadTs, operation, fetchMedia }: {
    readonly channel: string;
    readonly file: { buffer?: Buffer; url?: string; path?: string; name?: string };
    readonly threadTs?: string;
    readonly operation: EndpointOperation;
    readonly fetchMedia: OutboundMediaFetcher;
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
    // Downloaded on this host, so only through the pinned public-HTTPS fetch (#1250 第 46 批).
    buffer = (await operation.prepare(() => fetchMedia(url, { signal: operation.signal, source: 'slack' }))).bytes;
  }
  if (!buffer) throw new Error('Slack file contains no uploadable content');

  const options: Parameters<typeof upload>[0] = threadTs
    ? { channel_id: channel, file: buffer, filename: file.name ?? 'file', thread_ts: threadTs }
    : { channel_id: channel, file: buffer, filename: file.name ?? 'file' };
  await operation.run(() => upload.call(client, options));
}

export { keyboardToBlockKitBlocks };
