import { definePage } from '@zhin.js/console-contract';
import { useEffect, useRef, useState, type FormEvent } from 'react';

export const meta = definePage({
  title: 'Sandbox',
  icon: 'Box',
  order: 10,
});

/** Same keys as `@zhin.js/client` remoteApi — avoid hard dep from adapter package. */
const TOKEN_KEY = 'zhin_api_token';
const API_BASE_KEY = 'zhin_api_base';

/**
 * Resolve Host WebSocket URL for `/sandbox`.
 * Remote Console runs on a different origin; must use stored API base + token
 * (HttpHost upgrade requires Bearer/`?token=` when `http.token` is set).
 */
export function resolveSandboxWsUrl(): string {
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem(API_BASE_KEY)?.trim()
    : '';
  const runtimeToken = typeof window !== 'undefined'
    ? (window as unknown as { __ZHIN_API_TOKEN?: string }).__ZHIN_API_TOKEN?.trim()
    : '';
  const token = runtimeToken
    || (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null)
    || (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(TOKEN_KEY) : null)
    || '';

  let base = stored && stored.length > 0 ? stored.replace(/\/+$/u, '') : '';
  if (!base && typeof window !== 'undefined') base = window.location.origin;

  const url = new URL('/sandbox', `${base}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) url.searchParams.set('token', token);
  return url.href;
}

/**
 * Convention page (ADR 0046). Connects to Host `/sandbox` WS (not the UI origin).
 */
export default function SandboxPage() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('connecting…');
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<readonly { readonly kind: 'in' | 'out' | 'sys'; readonly text: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = () => {
      if (closed) return;
      const href = resolveSandboxWsUrl();
      setStatus(`connecting ${href.replace(/\?token=[^&]+/u, '?token=…')}…`);
      let ws: WebSocket;
      try {
        ws = new WebSocket(href);
      } catch (error) {
        setConnected(false);
        setStatus(`error: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      wsRef.current = ws;
      ws.addEventListener('open', () => {
        attempt = 0;
        setConnected(true);
        setStatus('WebSocket /sandbox connected');
      });
      ws.addEventListener('close', (event) => {
        setConnected(false);
        wsRef.current = null;
        if (closed) return;
        const reason = event.code === 1006
          ? 'abnormal close (check Host URL / token / CORS)'
          : `closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`;
        setStatus(reason);
        // Backoff reconnect — Host may restart or token may appear after login.
        const delay = Math.min(8_000, 500 * 2 ** attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, delay);
      });
      ws.addEventListener('error', () => {
        // close handler will fire; surface a hint for Remote Console misconfig
        setStatus((previous) => previous.startsWith('connecting')
          ? 'error: failed to open (is Host running? token set? WS path /sandbox?)'
          : previous);
      });
      ws.addEventListener('message', (event) => {
        let text = String(event.data);
        try {
          const data = JSON.parse(text) as {
            content?: Array<{ data?: { text?: string } }> | string;
            type?: string;
          };
          text = Array.isArray(data.content)
            ? data.content.map((segment) => segment?.data?.text ?? '').filter(Boolean).join('\n')
            : typeof data.content === 'string'
              ? data.content
              : text;
        } catch {
          /* keep raw */
        }
        setLines((previous) => [...previous, { kind: 'in', text }]);
      });
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    const ws = wsRef.current;
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ text, timestamp: Date.now() }));
    setLines((previous) => [...previous, { kind: 'out', text }]);
    setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 3rem)', maxWidth: 720, margin: '0 auto' }}>
      <p style={{ padding: '0.75rem 1rem', margin: 0, color: connected ? '#0f766e' : '#71717a', fontSize: 13 }}>
        {status}
      </p>
      <div style={{ flex: 1, overflow: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {lines.map((line, index) => (
          <div
            key={`${line.kind}-${index}-${line.text.slice(0, 12)}`}
            style={{
              alignSelf: line.kind === 'out' ? 'flex-end' : 'flex-start',
              background: line.kind === 'out' ? '#ccfbf1' : '#fff',
              border: '1px solid #e4e4e7',
              borderRadius: 10,
              padding: '0.6rem 0.8rem',
              maxWidth: '85%',
              whiteSpace: 'pre-wrap',
            }}
          >
            {line.text}
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e4e4e7' }}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="发送到 Host /sandbox …"
          style={{ flex: 1, padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid #d4d4d8' }}
        />
        <button
          type="submit"
          disabled={!connected}
          style={{
            padding: '0.55rem 0.9rem',
            border: 0,
            borderRadius: 8,
            background: connected ? '#0f766e' : '#a1a1aa',
            color: '#fff',
            cursor: connected ? 'pointer' : 'not-allowed',
          }}
        >
          发送
        </button>
      </form>
    </div>
  );
}
