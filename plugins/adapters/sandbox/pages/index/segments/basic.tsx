import React from 'react';
import { CodeBlock, MarkdownContent } from '@zhin.js/client';
import { sandboxText } from '../messages.js';
import { segmentFallbackText } from '../segmentFallback.js';
import { stringField, type SandboxSegmentRenderer } from './context.js';

/** `text` and `markdown`: the complete Markdown renderer (ADR 0064 G5), never raw HTML. */
export const renderText: SandboxSegmentRenderer = (data, context, key) => (
  <MarkdownContent key={key}
    text={stringField(data, 'text', 'content') || segmentFallbackText({ type: 'text', data }) || ''}
    className={context.isSent ? 'zhin-markdown--inverse' : undefined} />
);

export const renderCode: SandboxSegmentRenderer = (data, _context, key) => (
  <CodeBlock key={key} code={String(data.code ?? data.text ?? data.content ?? '')} language={String(data.language ?? data.lang ?? '')} />
);

export const renderMention: SandboxSegmentRenderer = (data, _context, key) => (
  <span key={key} className="sandbox-chip is-mention">@{String(data.name ?? data.target ?? data.qq ?? '')}</span>
);

export const renderFace: SandboxSegmentRenderer = (data, _context, key) => (
  <img key={key} src={`https://face.viki.moe/apng/${encodeURIComponent(String(data.id ?? ''))}.png`} alt={String(data.name ?? '')}
    className="sandbox-inline-face" title={String(data.name ?? data.id ?? '')} />
);

export const renderDice: SandboxSegmentRenderer = (data, { locale }, key) => (
  <span key={key} className="sandbox-chip">🎲 {data.result != null ? sandboxText(locale, "点数 {0}", [String(data.result)]) : sandboxText(locale, "骰子")}</span>
);

export const renderRps: SandboxSegmentRenderer = (data, { locale }, key) => (
  <span key={key} className="sandbox-chip">✊ {data.result != null ? sandboxText(locale, "结果 {0}", [String(data.result)]) : sandboxText(locale, "猜拳")}</span>
);

export const renderReply: SandboxSegmentRenderer = (data, { locale }, key) => (
  <div key={key} className="sandbox-reply-quote">
    {sandboxText(locale, "↩ 引用消息 #")}{String(data.message_id ?? data.id ?? '')}
  </div>
);
