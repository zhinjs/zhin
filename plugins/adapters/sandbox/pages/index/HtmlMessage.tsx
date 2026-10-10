import React, { useEffect, useRef, useState } from 'react';

/** HTML stays in an opaque-origin frame; only the size reporter can run scripts. */
export default function HtmlMessage({ html }: { readonly html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce] = useState(() => crypto.randomUUID());
  const [height, setHeight] = useState(240);

  useEffect(() => {
    const onSize = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow
        || event.data?.type !== 'sandbox-html-size'
        || event.data?.nonce !== nonce) return;
      const value = event.data.height;
      if (typeof value === 'number' && Number.isFinite(value)) {
        setHeight(Math.ceil(Math.min(1200, Math.max(32, value))));
      }
    };
    window.addEventListener('message', onSize);
    return () => window.removeEventListener('message', onSize);
  }, [nonce]);

  const srcDoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;padding:0;min-height:0}body{display:flow-root;overflow-wrap:anywhere}img{max-width:100%}</style></head><body>${html}<script nonce="${nonce}">const report=()=>parent.postMessage({type:'sandbox-html-size',nonce:'${nonce}',height:document.body.getBoundingClientRect().height},'*');new ResizeObserver(report).observe(document.body);report();<\/script></body></html>`;

  return <iframe
    ref={frame}
    title="HTML 消息"
    sandbox="allow-scripts"
    srcDoc={srcDoc}
    className="block w-full min-w-0 border-0 rounded-lg my-1 bg-transparent"
    style={{ height }}
  />;
}
