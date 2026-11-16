import { sandboxText, type SandboxLocale } from './messages.js';
import React, { useEffect, useRef, useState } from 'react';

/** Largest render width honoured from an HTML segment (wider requests render at this width). */
const MAX_RENDER_WIDTH = 4096;

/** A positive render width requested by the HTML segment (`data.width`), or `undefined`. */
export function htmlRenderWidth(value: unknown): number | undefined {
  const width = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof width === 'number' && Number.isFinite(width) && width >= 1 ? Math.min(MAX_RENDER_WIDTH, Math.round(width)) : undefined;
}

/** Scale that fits a `width`-wide render into `available` pixels (never enlarges). */
export function htmlRenderScale(width: number | undefined, available: number): number {
  if (!width || !(available > 0)) return 1;
  return Math.min(1, available / width);
}

/**
 * HTML stays in an opaque-origin frame; only the size reporter can run scripts. With a render
 * `width` (the HTML segment's `data.width`, e.g. 1080 for the command menu) the document is laid out
 * at that width — the same as the image the renderer sends to a platform — and the frame is scaled
 * down proportionally to the chat column (#1250 command-menu-unreadable-in-sandbox).
 */
export default function HtmlMessage({ html, locale = 'zh-CN', width: requestedWidth }: {
  readonly html: string; readonly locale?: SandboxLocale; readonly width?: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [nonce] = useState(createHtmlMessageNonce);
  const [height, setHeight] = useState(240);
  const [available, setAvailable] = useState(0);
  const width = htmlRenderWidth(requestedWidth);

  useEffect(() => {
    const element = box.current;
    if (!width || !element || typeof ResizeObserver === 'undefined') return;
    const measure = () => setAvailable(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [width]);

  useEffect(() => {
    const onSize = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow
        || event.data?.type !== 'sandbox-html-size'
        || event.data?.nonce !== nonce) return;
      const value = event.data.height;
      if (typeof value === 'number' && Number.isFinite(value)) {
        setHeight(Math.ceil(Math.min(width ? 12000 : 1200, Math.max(32, value))));
      }
    };
    window.addEventListener('message', onSize);
    return () => window.removeEventListener('message', onSize);
  }, [nonce, width]);

  const srcDoc = createHtmlMessageDocument(html, nonce, width);

  if (!width) {
    return <iframe
      ref={frame}
      title={sandboxText(locale, "HTML 消息")}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="sandbox-html-frame"
      style={{ height }}
    />;
  }
  const scale = htmlRenderScale(width, available);
  return <div ref={box} className="sandbox-html-scaled" style={{ height: Math.ceil(height * scale) }}>
    <iframe
      ref={frame}
      title={sandboxText(locale, "HTML 消息")}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      className="sandbox-html-frame"
      style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
    />
  </div>;
}

/** getRandomValues is available on ordinary HTTP LAN pages as well as HTTPS. */
export function createHtmlMessageNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The trusted reporter precedes raw markup so an unfinished tag cannot swallow it. */
export function createHtmlMessageDocument(html: string, nonce: string, width?: number): string {
  const renderWidth = htmlRenderWidth(width);
  const sized = renderWidth ? `html,body{width:${renderWidth}px;overflow:hidden}` : '';
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;min-height:0}body{display:flow-root;overflow-wrap:anywhere}img{max-width:100%}${sized}</style></head><body><script nonce="${nonce}">const report=()=>parent.postMessage({type:'sandbox-html-size',nonce:'${nonce}',height:document.body.getBoundingClientRect().height},'*');new ResizeObserver(report).observe(document.body);report();<\/script>${html}</body></html>`;
}
