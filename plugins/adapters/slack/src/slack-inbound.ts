/**
 * Slack 入站消息解析 — 将 Slack mrkdwn 文本 + attachments + files 转为 wire segments
 */
import type { MessageSegment } from 'zhin.js';
import type { SlackMessageEvent, SlackEvent } from './types.js';
import { mrkdwnToMarkdown } from './mrkdwn-to-markdown.js';

export function parseSlackMessageToSegments(msg: SlackMessageEvent): MessageSegment[] {
  const segments: MessageSegment[] = [];

  if (msg.text) {
    segments.push(...parseSlackMrkdwn(msg.text));
  }

  if ('files' in msg && Array.isArray(msg.files)) {
    for (const file of msg.files as Record<string, unknown>[]) {
      segments.push(parseSlackFile(file));
    }
  }

  if ('attachments' in msg && Array.isArray(msg.attachments)) {
    for (const att of msg.attachments as Record<string, unknown>[]) {
      if (att.image_url) {
        segments.push({
          type: 'image',
          data: {
            url: att.image_url,
            title: att.title,
            text: att.text,
          },
        });
      }
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', data: { text: '' } }];
}

function parseSlackFile(file: Record<string, unknown>): MessageSegment {
  const mime = String(file.mimetype ?? '');
  let type: string;
  if (mime.startsWith('image/')) type = 'image';
  else if (mime.startsWith('video/')) type = 'video';
  else if (mime.startsWith('audio/')) type = 'audio';
  else type = 'file';

  return {
    type,
    data: {
      id: file.id,
      name: file.name,
      url: file.url_private ?? file.permalink,
      size: file.size,
      mimetype: file.mimetype,
    },
  };
}

export function parseSlackMrkdwn(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  const allMatches: Array<{ match: RegExpExecArray; kind: 'user' | 'channel' | 'link' }> = [];

  const userRe = /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g;
  const chanRe = /<#([C][A-Z0-9]+)(?:\|([^>]+))?>/g;
  const linkRe = /<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/g;

  let m: RegExpExecArray | null;
  while ((m = userRe.exec(text)) !== null) allMatches.push({ match: m, kind: 'user' });
  while ((m = chanRe.exec(text)) !== null) allMatches.push({ match: m, kind: 'channel' });
  while ((m = linkRe.exec(text)) !== null) allMatches.push({ match: m, kind: 'link' });

  allMatches.sort((a, b) => a.match.index! - b.match.index!);

  for (const { match, kind } of allMatches) {
    const start = match.index!;
    if (start > lastIndex) {
      const before = text.slice(lastIndex, start);
      if (before.trim()) {
        segments.push({ type: 'text', data: { text: mrkdwnToMarkdown(before) } });
      }
    }

    switch (kind) {
      case 'user':
        segments.push({ type: 'at', data: { id: match[1], name: match[2] || match[1], text: match[0] } });
        break;
      case 'channel':
        segments.push({ type: 'channel_mention', data: { id: match[1], name: match[2] || match[1], text: match[0] } });
        break;
      case 'link':
        segments.push({ type: 'link', data: { url: match[1], text: match[2] || match[1] } });
        break;
    }
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    if (rest.trim()) {
      segments.push({ type: 'text', data: { text: mrkdwnToMarkdown(rest) } });
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', data: { text: mrkdwnToMarkdown(text) } }];
}

export function resolveSlackChannelType(event: SlackEvent): 'private' | 'group' {
  if (event.channel_type === 'im') return 'private';
  return 'group';
}
