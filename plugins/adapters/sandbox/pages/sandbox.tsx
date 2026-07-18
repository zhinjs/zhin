import { definePage } from '@zhin.js/console-contract';
import { useEffect, useRef, useState, type FormEvent } from 'react';

export const meta = definePage({
  title: 'Sandbox',
  icon: 'Box',
  order: 10,
});

/**
 * Convention page (ADR 0046). Plugin Runtime Host also serves a vanilla WS shell
 * for this localName so local smoke does not depend on a CDN React graph.
 */
export default function SandboxPage() {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<readonly { readonly kind: 'in' | 'out'; readonly text: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const url = new URL('/sandbox', window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.addEventListener('open', () => setConnected(true));
    ws.addEventListener('close', () => setConnected(false));
    ws.addEventListener('message', (event) => {
      let text = String(event.data);
      try {
        const data = JSON.parse(text) as {
          content?: Array<{ data?: { text?: string } }> | string;
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
    return () => {
      ws.close();
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
      <p style={{ padding: '0.75rem 1rem', margin: 0, color: '#71717a' }}>
        {connected ? 'WebSocket /sandbox connected' : 'connecting…'}
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
          placeholder="发送到 /sandbox …"
          style={{ flex: 1, padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid #d4d4d8' }}
        />
        <button type="submit" style={{ padding: '0.55rem 0.9rem', border: 0, borderRadius: 8, background: '#0f766e', color: '#fff' }}>
          发送
        </button>
      </form>
    </div>
  );
}
