import { randomUUID } from 'node:crypto';
import { readableLinkTarget, decodeReadableEntities } from '../readable-link.js';

const MAX_INPUT_LENGTH = 2 * 1024 * 1024;

/** Preserve link destinations and image descriptions without exposing embedded media. */
function readableLinks(text: string, literal: (value: string) => string, depth = 0): string {
  // Bound work for deliberately nested link labels. Such nesting is not portable Markdown.
  if (depth >= 16) return '[嵌套内容已省略]';
  const pairs = new Map<number, number>();
  const brackets: number[] = [];
  const parentheses: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '[') brackets.push(i);
    else if (text[i] === ']' && brackets.length) pairs.set(brackets.pop()!, i);
    else if (text[i] === '(') parentheses.push(i);
    else if (text[i] === ')' && parentheses.length) pairs.set(parentheses.pop()!, i);
  }
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    const image = text[i] === '!' && text[i + 1] === '[';
    const open = image ? i + 1 : i;
    if (text[open] !== '[') continue;
    const close = pairs.get(open);
    if (close === undefined || text[close + 1] !== '(') continue;
    const pairedEnd = pairs.get(close + 1);
    // An incomplete inline image/link must not dump its data URL into plain text.
    const lineEnd = pairedEnd === undefined ? text.indexOf('\n', close + 2) : -1;
    const end = pairedEnd ?? (lineEnd === -1 ? text.length : lineEnd);
    const label = readableLinks(text.slice(open + 1, close), literal, depth + 1);
    let destination = text.slice(close + 2, end).trim();
    // Optional Markdown titles are presentation, not part of the destination.
    if (destination.startsWith('<')) destination = destination.slice(1, destination.indexOf('>'));
    else destination = destination.split(/\s/u, 1)[0]!;
    const target = pairedEnd === undefined ? undefined : readableLinkTarget(destination);
    out.push(text.slice(start, i), image ? (label ? `[图片：${label}]` : '[图片]')
      : target ? (target === label || !label ? literal(target) : `${label} (${literal(target)})`) : label);
    start = pairedEnd === undefined ? end : end + 1;
    i = start - 1;
  }
  out.push(text.slice(start));
  return out.join('');
}

/** 将 Markdown 转为可读纯文本（出站 text 降级用）。代码内容不参与格式剥离。 */
export function markdownToPlainText(md: string): string {
  let text = md.slice(0, MAX_INPUT_LENGTH);
  // A collision-free marker keeps source code and URL underscores intact.
  let marker = `\uE000${randomUUID()}\uE001`;
  while (text.includes(marker)) marker = `\uE000${randomUUID()}\uE001`;
  const literal: string[] = [];
  const stash = (value: string) => `${marker}${literal.push(value) - 1}${marker}`;
  const lines = text.split('\n');
  let fence: { character: string; size: number; code: string[] } | undefined;
  text = lines.map(line => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (match && match[1]![0] === fence.character && match[1]!.length >= fence.size && !match[2]!.trim()) {
        const code = stash(fence.code.join('\n')); fence = undefined; return code;
      }
      fence.code.push(line); return undefined;
    }
    if (match) { fence = { character: match[1]![0]!, size: match[1]!.length, code: [] }; return undefined; }
    // Match equal-length tick runs in linear time, including multi-tick code spans.
    const runs = [...line.matchAll(/`+/gu)];
    const next = new Map<number, number>();
    const closing = new Map<number, number>();
    for (let i = runs.length - 1; i >= 0; i--) {
      const size = runs[i]![0].length;
      if (closing.has(size)) next.set(i, closing.get(size)!);
      closing.set(size, i);
    }
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < runs.length; i++) {
      const end = next.get(i);
      if (end === undefined) continue;
      out.push(line.slice(start, runs[i]!.index), stash(line.slice(runs[i]!.index + runs[i]![0].length, runs[end]!.index)));
      start = runs[end]!.index + runs[end]![0].length; i = end;
    }
    out.push(line.slice(start)); return out.join('');
  }).filter((line): line is string => line !== undefined).join('\n');
  if (fence) text += `${text ? '\n' : ''}${stash(fence.code.join('\n'))}`;
  text = readableLinks(decodeReadableEntities(text), stash);
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^[ \t]*>[ \t]?/gm, '');
  text = text.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');
  // A linear split avoids constructing a regular expression from user text.
  const chunks = text.split(marker);
  for (let i = 1; i < chunks.length; i += 2) {
    const index = Number(chunks[i]);
    if (Number.isInteger(index) && index >= 0 && index < literal.length) chunks[i] = literal[index]!;
  }
  return chunks.join('').trim() + (md.length > MAX_INPUT_LENGTH ? '\n\n[内容过长，已省略后续内容；请缩小查询范围或分页查看。]' : '');
}

export function markdownToHtmlForRender(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="white-space:pre-wrap;font-family:sans-serif;font-size:14px;line-height:1.5;padding:16px;">${escaped}</pre>`;
}
