import { useCallback, useState } from 'react';
import { apiFetch } from '../console-utils/remoteApi.js';

type OrchestrationTaskRow = {
  id: string;
  name: string;
  status: string;
  executor_kind?: string;
  assigned_to?: string;
  result_summary?: string;
  error?: string;
};

type OrchestrationEventRow = {
  seq: number;
  type: string;
  task_id?: string;
  payload_json?: string;
  created_at?: number;
};

type RunListItem = {
  run: { id: string; session_key: string; status: string; title: string };
  tasks: OrchestrationTaskRow[];
};

type RunDetail = RunListItem & {
  events?: OrchestrationEventRow[];
};

function parsePayload(raw?: string): string {
  if (!raw?.trim()) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

export default function OrchestrationRunsPage() {
  const [sessionKey, setSessionKey] = useState('');
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async () => {
    if (!sessionKey.trim()) {
      setError('请输入 sessionKey');
      return;
    }
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const res = await apiFetch(
        `/api/agent/orchestration/runs?sessionKey=${encodeURIComponent(sessionKey.trim())}`,
      );
      const body = await res.json() as { success?: boolean; error?: string; data?: { runs?: RunListItem[] } };
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setRuns(body.data?.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  const loadRunDetail = useCallback(async (runId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/agent/orchestration/runs/${encodeURIComponent(runId)}`);
      const body = await res.json() as { success?: boolean; error?: string; data?: RunDetail };
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSelected(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      <h1 className="text-lg font-semibold">编排 Run / Task / Event</h1>
      <p className="text-sm text-muted-foreground">
        从 OrchestrationKernel 投影（`GET /api/agent/orchestration/*`）。sessionKey 格式：
        <code className="mx-1">platform:endpointId:kind:sceneId</code>
      </p>

      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-[240px]">
          sessionKey
          <input
            className="border rounded px-2 py-1 text-sm bg-background"
            value={sessionKey}
            onChange={(e) => setSessionKey(e.target.value)}
            placeholder="sandbox:solo-bot:private:user1"
          />
        </label>
        <button
          type="button"
          className="border rounded px-3 py-1 text-sm hover:bg-muted"
          disabled={loading}
          onClick={() => void loadRuns()}
        >
          查询 Runs
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="border rounded p-3 space-y-2">
          <h2 className="text-sm font-medium">Runs ({runs.length})</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">无数据</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {runs.map((item) => (
                <li key={item.run.id} className="border rounded p-2">
                  <button
                    type="button"
                    className="text-left w-full hover:underline"
                    onClick={() => void loadRunDetail(item.run.id)}
                  >
                    <div className="font-mono text-xs">{item.run.id}</div>
                    <div>{item.run.title || '(无标题)'}</div>
                    <div className="text-muted-foreground">
                      {item.run.status}
                      {' · '}
                      {item.tasks.length}
                      {' tasks'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border rounded p-3 space-y-3">
          <h2 className="text-sm font-medium">Run 详情</h2>
          {!selected ? (
            <p className="text-sm text-muted-foreground">选择左侧 Run</p>
          ) : (
            <>
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">ID </span>
                  <code>{selected.run.id}</code>
                </div>
                <div>
                  <span className="text-muted-foreground">状态 </span>
                  {selected.run.status}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium uppercase text-muted-foreground mb-1">Tasks</h3>
                <ul className="space-y-2 text-sm">
                  {selected.tasks.map((task) => (
                    <li key={task.id} className="border rounded p-2 font-mono text-xs">
                      <div>
                        {task.id}
                        {' · '}
                        {task.status}
                        {' · '}
                        {task.executor_kind ?? 'local'}
                      </div>
                      <div>{task.name}</div>
                      {task.result_summary ? (
                        <div className="mt-1 whitespace-pre-wrap break-words">{task.result_summary}</div>
                      ) : null}
                      {task.error ? (
                        <div className="mt-1 text-red-600 whitespace-pre-wrap">{task.error}</div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-xs font-medium uppercase text-muted-foreground mb-1">Events</h3>
                <ul className="space-y-2 text-xs max-h-64 overflow-auto">
                  {(selected.events ?? []).map((ev) => (
                    <li key={ev.seq} className="border rounded p-2">
                      <div>
                        #
                        {ev.seq}
                        {' '}
                        {ev.type}
                        {ev.task_id ? ` · task ${ev.task_id}` : ''}
                      </div>
                      {ev.payload_json ? (
                        <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] opacity-80">
                          {parsePayload(ev.payload_json)}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
