import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../console-utils/remoteApi.js';
import { buildWaterfall, formatTime, toQueryTime, type TraceDetail } from './traceView.js';

type SessionRow = { session_key: string; turns: number; last_started_at: number; last_status: string; total_tokens: number };
type TurnRow = { turn_id: string; started_at: number; duration_ms?: number; model_calls: number; tool_calls: number; total_tokens: number; termination: { status: string; code?: string } };

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  const body = await res.json() as { success?: boolean; error?: string; data?: T };
  if (!res.ok || !body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.data as T;
}

const statusClass = (status: string) => (status === 'completed' ? 'text-emerald-600' : status === 'running' ? 'text-sky-600' : 'text-rose-600');

/** Persisted Agent turn traces: sessions → turns → turn detail (#728). */
export default function TraceArchivePage() {
  const initialTurn = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('turn') ?? '' : '';
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [session, setSession] = useState('');
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [error, setError] = useState('');

  const window = useMemo(() => {
    const params = new URLSearchParams();
    const s = toQueryTime(since);
    const u = toQueryTime(until);
    if (s) params.set('since', s);
    if (u) params.set('until', u);
    return params;
  }, [since, until]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setError('');
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, []);

  const loadSessions = useCallback(() => run(async () => {
    setSessions(await getJson<SessionRow[]>(`/api/agent/trace-archive/sessions?${window}`));
  }), [run, window]);

  const openSession = useCallback((key: string) => run(async () => {
    setSession(key);
    setDetail(null);
    const params = new URLSearchParams(window);
    params.set('sessionKey', key);
    setTurns(await getJson<TurnRow[]>(`/api/agent/trace-archive/turns?${params}`));
  }), [run, window]);

  const openTurn = useCallback((turnId: string) => run(async () => {
    setDetail(await getJson<TraceDetail>(`/api/agent/trace-archive/turn?turnId=${encodeURIComponent(turnId)}`));
  }), [run]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);
  useEffect(() => { if (initialTurn) void openTurn(initialTurn); }, [initialTurn, openTurn]);

  const bars = useMemo(() => (detail ? buildWaterfall(detail) : []), [detail]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agent Trace</h1>
          <p className="mt-1 text-sm text-muted-foreground">已落盘的回合记录（默认保留 7 天）：会话 → 回合 → 详情。命令行同样可用 <code>zhin trace --sessions</code>。</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col">起<input type="datetime-local" className="border rounded px-2 py-1" value={since} onChange={(e) => setSince(e.target.value)} /></label>
          <label className="flex flex-col">止<input type="datetime-local" className="border rounded px-2 py-1" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
          <button type="button" className="border rounded px-3 py-1" onClick={() => void loadSessions()}>刷新</button>
        </div>
      </header>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section>
          <h2 className="font-medium mb-2">会话（{sessions.length}）</h2>
          <ul className="divide-y border rounded text-sm">
            {sessions.map((s) => (
              <li key={s.session_key}>
                <button type="button" className={`w-full text-left px-3 py-2 ${s.session_key === session ? 'bg-muted' : ''}`} onClick={() => void openSession(s.session_key)}>
                  <div className="font-mono truncate">{s.session_key}</div>
                  <div className="text-xs text-muted-foreground">{s.turns} 回合 · {formatTime(s.last_started_at)} · <span className={statusClass(s.last_status)}>{s.last_status}</span> · {s.total_tokens} tokens</div>
                </button>
              </li>
            ))}
            {sessions.length === 0 && <li className="px-3 py-2 text-muted-foreground">没有记录</li>}
          </ul>
        </section>
        <section>
          <h2 className="font-medium mb-2">回合{session ? `（${turns.length}）` : ''}</h2>
          <ul className="divide-y border rounded text-sm">
            {turns.map((t) => (
              <li key={t.turn_id}>
                <button type="button" className={`w-full text-left px-3 py-2 ${detail?.turn_id === t.turn_id ? 'bg-muted' : ''}`} onClick={() => void openTurn(t.turn_id)}>
                  <div className="font-mono truncate">{t.turn_id}</div>
                  <div className="text-xs text-muted-foreground">{formatTime(t.started_at)} · {t.duration_ms ?? '—'}ms · 模型 {t.model_calls} · 工具 {t.tool_calls} · {t.total_tokens} tokens · <span className={statusClass(t.termination.status)}>{t.termination.status}{t.termination.code ? ` (${t.termination.code})` : ''}</span></div>
                </button>
              </li>
            ))}
            {session && turns.length === 0 && <li className="px-3 py-2 text-muted-foreground">没有回合</li>}
          </ul>
        </section>
      </div>
      {detail && (
        <section className="space-y-3 border rounded p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium font-mono">{detail.turn_id}</h2>
            <button type="button" className="border rounded px-3 py-1 text-sm" onClick={() => setShowRaw((v) => !v)}>{showRaw ? '隐藏原始记录' : '原始记录'}</button>
          </div>
          <p className="text-sm text-muted-foreground">
            {detail.session_key} · {detail.principal ? `${detail.principal.display_name ?? detail.principal.subject_id}（${detail.principal.trust_level ?? detail.principal.roles.join(',')}）` : '—'} · {formatTime(detail.started_at)} · {detail.duration_ms ?? '—'}ms ·{' '}
            <span className={statusClass(detail.termination.status)}>{[detail.termination.status, detail.termination.code, detail.termination.reason].filter(Boolean).join(' ')}</span>
          </p>
          <div className="space-y-1" aria-label="waterfall">
            {bars.map((bar) => (
              <div key={bar.key} className="flex items-center gap-2 text-xs" title={bar.title}>
                <span className="w-40 shrink-0 truncate font-mono">{bar.label}</span>
                <div className="relative h-3 flex-1 bg-muted rounded">
                  <div className={`absolute h-3 rounded ${bar.failed ? 'bg-rose-500' : bar.kind === 'model' ? 'bg-sky-500' : 'bg-emerald-500'}`} style={{ left: `${bar.left}%`, width: `${bar.width}%` }} />
                </div>
              </div>
            ))}
          </div>
          <ol className="text-xs font-mono space-y-0.5 max-h-72 overflow-auto">
            {detail.timeline.map((entry, index) => <li key={index}>+{entry.at_ms}ms {entry.kind} {entry.detail}</li>)}
          </ol>
          {showRaw && <pre className="text-xs overflow-auto max-h-96 bg-muted p-2 rounded">{JSON.stringify(detail, null, 2)}</pre>}
        </section>
      )}
    </div>
  );
}
