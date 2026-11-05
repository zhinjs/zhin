import { useCallback, useEffect, useState } from 'react';
import {
  AGENT_COLLABORATION_RPC,
  type ConsoleEngagementDetail,
  type ConsoleEngagementSummary,
  type ConsoleVenueDefinition,
} from '@zhin.js/console-protocol';
import { apiFetch, consoleRpc } from '../console-utils/remoteApi.js';

export function useEngagements(limit = 50) {
  const [engagements, setEngagements] = useState<readonly ConsoleEngagementSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await consoleRpc<{ engagements?: readonly ConsoleEngagementSummary[] }>(
        AGENT_COLLABORATION_RPC.ENGAGEMENTS_LIST,
        { limit },
      );
      setEngagements(result?.engagements ?? []);
    } catch {
      try {
        const res = await apiFetch(`/api/agent/engagements?limit=${encodeURIComponent(String(limit))}`);
        const body = await res.json() as {
          success?: boolean;
          error?: string;
          data?: { engagements?: readonly ConsoleEngagementSummary[] };
        };
        if (!res.ok || !body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
        setEngagements(body.data?.engagements ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setEngagements([]);
      }
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { engagements, loading, error, reload };
}

export function useEngagementDetail(engagementId: string | null) {
  const [detail, setDetail] = useState<ConsoleEngagementDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async (targetId?: string | null) => {
    const id = (targetId ?? engagementId ?? '').trim();
    if (!id) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await consoleRpc<ConsoleEngagementDetail>(
        AGENT_COLLABORATION_RPC.ENGAGEMENTS_GET,
        { engagementId: id },
      );
      setDetail(result);
    } catch {
      try {
        const res = await apiFetch(`/api/agent/engagements/${encodeURIComponent(id)}`);
        const body = await res.json() as {
          success?: boolean;
          error?: string;
          data?: ConsoleEngagementDetail;
        };
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setDetail(body.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setDetail(null);
      }
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => {
    void reload(engagementId);
  }, [engagementId, reload]);

  return { detail, loading, error, reload };
}

export function useVenues() {
  const [venues, setVenues] = useState<readonly ConsoleVenueDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await consoleRpc<{ venues?: readonly ConsoleVenueDefinition[] }>(
        AGENT_COLLABORATION_RPC.VENUES_LIST,
        {},
      );
      setVenues(result?.venues ?? []);
    } catch {
      try {
        const res = await apiFetch('/api/agent/venues');
        const body = await res.json() as {
          success?: boolean;
          error?: string;
          data?: { venues?: readonly ConsoleVenueDefinition[] };
        };
        if (!res.ok || !body.success) throw new Error(body.error ?? `HTTP ${res.status}`);
        setVenues(body.data?.venues ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setVenues([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { venues, loading, error, reload };
}

export default function WorkroomRunsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'graph' | 'board' | 'events'>('graph');
  const { engagements, loading: listLoading, error: listError, reload: reloadList } = useEngagements(50);
  const { detail, loading: detailLoading, error: detailError } = useEngagementDetail(selectedId);
  const { venues } = useVenues();

  const error = listError || detailError;
  const loading = listLoading || detailLoading;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Agent Collaboration Harness
          </span>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Engagement 协作图谱</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            查看多 Agent 协作会话（Engagement）的 Actor 跳转链路、预算消耗、共享黑板（Board）与 Venue 房间声明（ADR 0048）。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            disabled={loading}
            onClick={() => void reloadList()}
          >
            {loading ? '刷新中…' : '刷新列表'}
          </button>
          <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">只读事实投影</span>
        </div>
      </header>

      {venues.length > 0 ? (
        <section className="rounded-xl border p-3 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            已声明 Venues ({venues.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            {venues.map((venue) => (
              <div key={venue.key} className="rounded-lg border bg-muted/20 px-3 py-1.5 text-xs">
                <span className="font-mono font-medium">{venue.key}</span>
                <span className="ml-2 text-muted-foreground">
                  {venue.channel.endpoint.adapter}:{venue.channel.endpoint.id}/{venue.channel.kind}:{venue.channel.id}
                </span>
                <span className="ml-2 rounded border px-1.5 py-0.5 text-[10px]">
                  {venue.floor ?? 'open'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.5fr)]">
        <section className="rounded-xl border p-3 space-y-2">
          <h2 className="text-sm font-medium">Engagements ({engagements.length})</h2>
          {engagements.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无协作记录</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {engagements.map((item) => (
                <li
                  key={item.engagementId}
                  className={`rounded-lg border p-2.5 transition-colors ${
                    selectedId === item.engagementId ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/30'
                  }`}
                >
                  <button
                    type="button"
                    className="text-left w-full"
                    onClick={() => setSelectedId(item.engagementId)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs truncate">{item.engagementId}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(item.status)}`}>
                        {item.status}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.venue ? `venue: ${item.venue} · ` : ''}
                      {item.hops} hops · {item.turns} turns · {item.tokensUsed} tokens · {item.wallClockMs}ms
                    </div>
                    {item.participants.length > 0 ? (
                      <div className="mt-1 text-[11px] font-mono text-muted-foreground truncate">
                        participants: {item.participants.join(', ')}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border p-3 space-y-3">
          <h2 className="text-sm font-medium">Engagement 协作详情</h2>
          {!detail ? (
            <p className="text-sm text-muted-foreground">选择左侧 Engagement 查看 Actor 拓扑、预算与共享黑板</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/25 p-3 text-sm">
                <div>
                  <code className="font-mono text-xs">{detail.summary.engagementId}</code>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {detail.summary.venue ? `Venue: ${detail.summary.venue} · ` : 'DM / Ephemeral · '}
                    参与方: {detail.summary.participants.join(', ') || '—'}
                    {detail.summary.stopReason ? ` · 终止原因: ${detail.summary.stopReason}` : ''}
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(detail.summary.status)}`}>
                  {detail.summary.status}
                </span>
              </div>

              <dl className="grid grid-cols-2 overflow-hidden rounded-lg border text-sm sm:grid-cols-4">
                <div className="p-2.5">
                  <dt className="text-xs text-muted-foreground">Hops</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{detail.summary.hops}</dd>
                </div>
                <div className="border-l p-2.5">
                  <dt className="text-xs text-muted-foreground">Turns</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{detail.summary.turns}</dd>
                </div>
                <div className="border-t p-2.5 sm:border-l sm:border-t-0">
                  <dt className="text-xs text-muted-foreground">Tokens</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{detail.summary.tokensUsed}</dd>
                </div>
                <div className="border-l border-t p-2.5 sm:border-t-0">
                  <dt className="text-xs text-muted-foreground">Wall clock</dt>
                  <dd className="mt-0.5 font-medium tabular-nums">{detail.summary.wallClockMs}ms</dd>
                </div>
              </dl>

              <div className="flex gap-1 rounded-lg bg-muted/35 p-1" role="tablist" aria-label="Engagement 详情视图">
                {(['graph', 'board', 'events'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={detailTab === tab}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${
                      detailTab === tab ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() => setDetailTab(tab)}
                  >
                    {tab === 'graph'
                      ? '协作链路'
                      : tab === 'board'
                        ? `共享黑板 (${detail.board.length})`
                        : `事件流 (${detail.events.length})`}
                  </button>
                ))}
              </div>

              {detailTab === 'graph' && (
                <ul className="space-y-2 text-xs font-mono">
                  {detail.events.map((event, idx) => (
                    <li key={idx} className="rounded-lg border p-2.5">
                      <span className="font-semibold text-foreground">{String(event.kind ?? 'event')}</span>
                      <span className="ml-2 text-muted-foreground">{formatCollaborationEvent(event)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {detailTab === 'board' && (
                <ul className="space-y-2 text-sm">
                  {detail.board.length === 0 ? (
                    <li className="py-6 text-center text-muted-foreground">黑板暂无键值</li>
                  ) : (
                    detail.board.map((entry) => (
                      <li key={entry.key} className="rounded-lg border p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <code className="font-mono text-xs font-semibold">{entry.key}</code>
                          <span className="text-xs text-muted-foreground">
                            v{entry.version} · {formatActorRef(entry.updatedBy)}
                          </span>
                        </div>
                        <pre className="overflow-auto rounded bg-muted/35 p-2 text-xs font-mono">
                          {typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2)}
                        </pre>
                      </li>
                    ))
                  )}
                </ul>
              )}

              {detailTab === 'events' && (
                <pre className="overflow-auto max-h-96 rounded-lg border bg-muted/25 p-3 text-xs font-mono">
                  {JSON.stringify(detail.events, null, 2)}
                </pre>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function formatActorRef(actor: unknown): string {
  if (!actor || typeof actor !== 'object') return 'unknown';
  const rec = actor as Record<string, unknown>;
  if (rec.kind === 'agent') return `agent:${String(rec.name ?? '')}`;
  if (rec.kind === 'external') return `external:${String(rec.peer ?? '')}`;
  if (rec.kind === 'human') return `human:${String(rec.principalId ?? '')}`;
  return JSON.stringify(rec);
}

function formatCollaborationEvent(event: Record<string, unknown>): string {
  switch (event.kind) {
    case 'engagement.started':
      return `initiator=${formatActorRef(event.initiator)}${event.venue ? ` venue=${String(event.venue)}` : ''}`;
    case 'mail.sent': {
      const env = (event.envelope ?? {}) as Record<string, unknown>;
      return `${formatActorRef(env.from)} -> ${formatActorRef(env.to)} [${String(env.kind ?? 'mail')}]`;
    }
    case 'mail.delivered':
      return `${String(event.messageId ?? '')} -> ${formatActorRef(event.recipient)} (${String(event.outcome ?? '')})`;
    case 'board.updated': {
      const entry = (event.entry ?? {}) as Record<string, unknown>;
      return `${String(entry.key ?? '')} (v${String(entry.version ?? 1)}) by ${formatActorRef(entry.updatedBy)}`;
    }
    case 'floor.granted':
      return `${String(event.venue ?? '')}: speaker=${formatActorRef(event.speaker)}`;
    case 'budget.recorded':
      return `hops=${String(event.hops ?? 0)} turns=${String(event.turns ?? 0)} tokens=${String(event.tokensUsed ?? 0)}`;
    case 'engagement.stopped':
      return `status=${String(event.status ?? '')}${event.reason ? ` reason=${String(event.reason)}` : ''}`;
    default:
      return JSON.stringify(event);
  }
}

function statusTone(status: string): string {
  if (/completed|accepted|approved|passed/u.test(status)) {
    return 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300';
  }
  if (/failed|lost|rejected|expired/u.test(status)) {
    return 'border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300';
  }
  return 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-300';
}
