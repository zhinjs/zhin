import React from 'react';
import { CodeBlock, MarkdownContent, isSafeMarkdownHref, pickMediaRawUrl, resolveMediaSrc } from '@zhin.js/client';
import { Button } from '@zhin.js/console-ui';
import { Check, ExternalLink, Link as LinkIcon } from 'lucide-react';
import { sandboxText } from '../messages.js';
import { stringField, type SandboxSegmentRenderer } from './context.js';
import { interactionVariant } from './keyboard.js';

/** An external link target safe for `href`: http(s) / mailto only. */
export function safeLinkHref(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const href = value.trim();
  return /^(https?:|mailto:)/iu.test(href) && isSafeMarkdownHref(href) ? href : undefined;
}

function hostOf(href: string): string {
  try { return new URL(href).host || href; } catch { return href; }
}

export const renderCard: SandboxSegmentRenderer = (data, context, key) => {
  const d = data as Record<string, unknown>;
  const title = stringField(d, 'title');
  const subtitle = stringField(d, 'subtitle');
  const description = stringField(d, 'description', 'content', 'summary');
  const rawImage = stringField(d, 'image', 'thumbnail', 'imageUrl') || pickMediaRawUrl(d);
  const imageSrc = rawImage ? resolveMediaSrc(rawImage, 'image') : undefined;
  const fields = Array.isArray(d.fields) ? (d.fields as Array<Record<string, unknown>>) : [];
  const buttons = Array.isArray(d.buttons)
    ? (d.buttons as Array<Record<string, unknown>>)
    : Array.isArray(d.actions) ? (d.actions as Array<Record<string, unknown>>) : [];
  // Several actions on one card stay usable after a click (#1250 sandbox-submitted-without-feedback).
  const submitted = new Set(context.submittedPayloads ?? []);
  return (
    <div key={key} className="sandbox-rich-card">
      {imageSrc && (
        /* lgtm[js/xss,js/client-side-unvalidated-url-redirection] */
        <img src={imageSrc} alt={title} className="sandbox-rich-card-image" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
      )}
      <div className="sandbox-rich-card-body">
        {title && <div className="sandbox-rich-card-title">{title}</div>}
        {subtitle && <div className="sandbox-rich-card-subtitle">{subtitle}</div>}
        {description && <div className="sandbox-rich-card-desc"><MarkdownContent text={description} /></div>}
        {fields.length > 0 && (
          <dl className="sandbox-rich-card-fields">
            {fields.map((field, fi) => (
              <div key={fi} className="sandbox-rich-card-field">
                <dt>{String(field.label ?? field.name ?? field.key ?? '')}</dt>
                <dd>{String(field.value ?? '')}</dd>
              </div>
            ))}
          </dl>
        )}
        {buttons.length > 0 && (
          <div className="agent-playground-approval-actions sandbox-rich-card-actions">
            <div>
              {buttons.map((btn, bi) => {
                const label = String(btn.label ?? btn.text ?? btn.title ?? btn.id ?? `Action ${bi + 1}`);
                const payload = String(btn.payload ?? btn.value ?? btn.url ?? btn.id ?? label);
                return (
                  <Button key={`${payload}-${bi}`} type="button" size="sm"
                    variant={interactionVariant(btn.style === 'primary', btn.style === 'danger')}
                    disabled={Boolean(btn.disabled) || !context.canInteract}
                    aria-pressed={submitted.has(payload) ? true : undefined}
                    onClick={() => { context.sendAction(payload, typeof btn.id === 'string' && btn.id ? btn.id : undefined); }}>
                    {submitted.has(payload) && <Check size={12} aria-hidden="true" />}
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
        {!title && !subtitle && !description && fields.length === 0 && buttons.length === 0 && (
          <CodeBlock code={JSON.stringify(d, null, 2)} language="json" />
        )}
      </div>
    </div>
  );
};

/** ADR 0064 G7: a share / music card; a playable `audio` gets a player (same source checks as media). */
export const renderShare: SandboxSegmentRenderer = (data, { locale }, key) => {
  const d = data as Record<string, unknown>;
  const href = safeLinkHref(d.url);
  const url = stringField(d, 'url');
  const title = stringField(d, 'title') || url || 'Share';
  const description = stringField(d, 'description', 'content', 'artist');
  const rawImage = stringField(d, 'image') || pickMediaRawUrl(d);
  const imageSrc = rawImage ? resolveMediaSrc(rawImage, 'image') : undefined;
  const audioSrc = typeof d.audio === 'string' ? resolveMediaSrc(d.audio, 'audio') : undefined;
  return (
    <div key={key} className="sandbox-share-card">
      <div className="sandbox-share-card-row">
        {imageSrc && (
          /* lgtm[js/xss,js/client-side-unvalidated-url-redirection] */
          <img src={imageSrc} alt={title} className="sandbox-share-card-thumb" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )}
        <div className="sandbox-share-card-main">
          <div className="sandbox-share-card-title">
            {href
              ? <a className="sandbox-share-card-link" href={href} target="_blank" rel="noreferrer">{title} <ExternalLink size={12} aria-hidden="true" /></a>
              : <span>{title} <ExternalLink size={12} aria-hidden="true" /></span>}
          </div>
          {description && <div className="sandbox-share-card-desc">{description}</div>}
          {url && <div className="sandbox-share-card-url">{url}</div>}
        </div>
      </div>
      {audioSrc && (
        // resolveMediaSrc allowlists non-executable URL schemes and audio data MIME types.
        <audio src={audioSrc} controls preload="none" className="sandbox-share-card-audio" aria-label={sandboxText(locale, "播放 {0}", [title])} />
      )}
    </div>
  );
};

/** ADR 0064 G6: a link card (title, host) that opens in a new tab; unsafe schemes stay text. */
export const renderLink: SandboxSegmentRenderer = (data, _context, key) => {
  const url = stringField(data, 'url', 'href');
  const text = stringField(data, 'text', 'title') || url;
  const href = safeLinkHref(url);
  if (!href) return <span key={key} className="sandbox-link-card is-inert">{text}</span>;
  return (
    <a key={key} className="sandbox-link-card" href={href} target="_blank" rel="noreferrer">
      <LinkIcon size={14} aria-hidden="true" />
      <span className="sandbox-link-card-text">{text}</span>
      {text !== href && <span className="sandbox-link-card-host">{hostOf(href)}</span>}
    </a>
  );
};

export const renderForward: SandboxSegmentRenderer = (data, context, key) => {
  const messages = data.messages as ReadonlyArray<ReadonlyArray<unknown>> | undefined;
  const title = stringField(data, 'title') || sandboxText(context.locale, "聊天记录");
  return (
    <div key={key} className="sandbox-forward">
      <div className="sandbox-forward-title">📨 {title}</div>
      {Array.isArray(messages) && messages.length > 0 ? (
        <div className="sandbox-forward-list">
          {messages.slice(0, 3).map((batch, bi) => (
            <div key={bi}>{Array.isArray(batch) ? context.renderNested(batch) : null}</div>
          ))}
          {messages.length > 3 && <div className="sandbox-forward-more">{sandboxText(context.locale, "…共")}{messages.length} {sandboxText(context.locale, "条")}</div>}
        </div>
      ) : (
        <div className="sandbox-forward-empty">{sandboxText(context.locale, "[合并转发]")}</div>
      )}
    </div>
  );
};
