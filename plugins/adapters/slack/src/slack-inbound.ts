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

  for (const token of scanSlackTokens(text)) {
    const start = token.start;
    if (start > lastIndex) {
      const before = text.slice(lastIndex, start);
      if (before.trim()) {
        segments.push({ type: 'text', data: { text: mrkdwnToMarkdown(before) } });
      }
    }

    switch (token.kind) {
      case 'user':
        segments.push({ type: 'at', data: { id: token.id, name: token.label || token.id, text: token.raw } });
        break;
      case 'channel':
        segments.push({ type: 'channel_mention', data: { id: token.id, name: token.label || token.id, text: token.raw } });
        break;
      case 'link':
        segments.push({ type: 'link', data: { url: token.url, text: token.label || token.url } });
        break;
    }
    lastIndex = start + token.raw.length;
  }

  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    if (rest.trim()) {
      segments.push({ type: 'text', data: { text: mrkdwnToMarkdown(rest) } });
    }
  }

  return segments.length > 0 ? segments : [{ type: 'text', data: { text: mrkdwnToMarkdown(text) } }];
}

type SlackToken =
  | { kind: 'user' | 'channel'; start: number; raw: string; id: string; label?: string }
  | { kind: 'link'; start: number; raw: string; url: string; label?: string };

function scanSlackTokens(text: string): SlackToken[] {
  const tokens: SlackToken[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);
    if (start < 0) break;
    const end = text.indexOf('>', start + 1);
    if (end < 0) break;
    const raw = text.slice(start, end + 1);
    const body = raw.slice(1, -1);
    const sep = body.indexOf('|');
    const head = sep >= 0 ? body.slice(0, sep) : body;
    const label = sep >= 0 ? body.slice(sep + 1) : undefined;

    if ((head.startsWith('@U') || head.startsWith('@W')) && isSlackId(head.slice(1))) {
      tokens.push({ kind: 'user', start, raw, id: head.slice(1), label });
    } else if (head.startsWith('#C') && isSlackId(head.slice(1))) {
      tokens.push({ kind: 'channel', start, raw, id: head.slice(1), label });
    } else if (head.startsWith('http://') || head.startsWith('https://')) {
      tokens.push({ kind: 'link', start, raw, url: head, label });
    }
    cursor = end + 1;
  }
  return tokens;
}

function isSlackId(value: string): boolean {
  if (!value) return false;
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    if (!isDigit && !isUpper) return false;
  }
  return true;
}

export function resolveSlackChannelType(event: SlackEvent): 'private' | 'group' {
  if (event.channel_type === 'im') return 'private';
  return 'group';
}
