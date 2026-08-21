import { useCallback, useState } from 'react';
import { apiFetch } from '../console-utils/remoteApi.js';

type WorkroomTask = {
  key: string;
  title: string;
  status: string;
  revision: number;
  attempt: number;
  maxAttempts: number;
  reportRef?: string;
  terminalReason?: string;
};

type RunListItem = {
  runId: string;
  projectId: string;
  status: string;
  title: string;
  sequence: number;
  tasks: Record<string, WorkroomTask>;
};

type RunDetail = RunListItem;

export default function WorkroomRunsPage() {
  const [projectId, setProjectId] = useState('');
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async () => {
    if (!projectId.trim()) {
      setError('请输入 projectId');
      return;
    }
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      const res = await apiFetch(
        `/api/agent/workroom/runs?projectId=${encodeURIComponent(projectId.trim())}`,
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
  }, [projectId]);

  const loadRunDetail = useCallback(async (runId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/agent/workroom/runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(projectId.trim())}`);
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
  }, [projectId]);

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      <h1 className="text-lg font-semibold">Workroom Run / Task / Assignment</h1>
      <p className="text-sm text-muted-foreground">
        从 WorkroomKernel 事件流投影（`GET /api/agent/workroom/*`）。查询必须提供显式 Project ID。
      </p>

      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-[240px]">
          projectId
          <input
            className="border rounded px-2 py-1 text-sm bg-background"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="project-alpha"
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
                <li key={item.runId} className="border rounded p-2">
                  <button
                    type="button"
                    className="text-left w-full hover:underline"
                    onClick={() => void loadRunDetail(item.runId)}
                  >
                    <div className="font-mono text-xs">{item.runId}</div>
                    <div>{item.title || '(无标题)'}</div>
                    <div className="text-muted-foreground">
                      {item.status}
                      {' · '}
                      {Object.keys(item.tasks).length}
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
                  <code>{selected.runId}</code>
                </div>
                <div>
                  <span className="text-muted-foreground">状态 </span>
                  {selected.status}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-medium uppercase text-muted-foreground mb-1">Tasks</h3>
                <ul className="space-y-2 text-sm">
                  {Object.values(selected.tasks).map((task) => (
                    <li key={task.key} className="border rounded p-2 font-mono text-xs">
                      <div>
                        {task.key}
                        {' · '}
                        {task.status}
                        {' · '}
                        rev {task.revision} · attempt {task.attempt}/{task.maxAttempts}
                      </div>
                      <div>{task.title}</div>
                      {task.reportRef ? (
                        <div className="mt-1 whitespace-pre-wrap break-words">report: {task.reportRef}</div>
                      ) : null}
                      {task.terminalReason ? (
                        <div className="mt-1 text-red-600 whitespace-pre-wrap">{task.terminalReason}</div>
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
