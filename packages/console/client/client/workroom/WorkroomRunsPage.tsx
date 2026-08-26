import { useCallback, useState } from 'react';
import { apiFetch, consoleRpc } from '../console-utils/remoteApi.js';

type PlanningSetupStatus = {
  projectId: string;
  ready: boolean;
  principalId?: string;
  trustedPackPublisher: boolean;
  projectSponsor: boolean;
  catalogReady: boolean;
  registryRevision: number;
  activeProfile?: { revisionId: string; digest: string };
  planningPolicyReady: boolean;
  disclosureReady: boolean;
  disclosureConfigReady: boolean;
  modelProviderAlias?: string;
  availableAgents: string[];
  availableTools: string[];
  availableSkills: string[];
  diagnostics: string[];
};

type WorkroomTask = {
  key: string;
  title: string;
  status: string;
  revision: number;
  attempt: number;
  maxAttempts: number;
  reportRef?: string;
  terminalReason?: string;
  currentAssignmentId?: string;
  blockers?: Array<{ id: string; kind: string; owner: string; reason: string; deadline: number }>;
  latestProgress?: { summary: string; completedUnits?: number; totalUnits?: number };
};

type WorkroomAssignment = {
  id: string;
  taskKey: string;
  role: string;
  status: string;
  owner: string;
  attempt: number;
  leaseExpiresAt: number;
  latestProgress?: { summary: string; completedUnits?: number; totalUnits?: number };
  outcome?: string;
};

type WorkroomWait = {
  id: string;
  taskKey: string;
  status: string;
  owner: string;
  route: string;
  riskTier: string;
  deadline: number;
};

type RunListItem = {
  runId: string;
  projectId: string;
  status: string;
  title: string;
  sequence: number;
  now: number;
  cancelRequested: boolean;
  tasks: Record<string, WorkroomTask>;
  assignments: Record<string, WorkroomAssignment>;
  reviewerAssignments: Record<string, WorkroomWait>;
  sponsorGates: Record<string, WorkroomWait>;
};

type RunDetail = RunListItem;

export default function WorkroomRunsPage() {
  const [projectId, setProjectId] = useState('');
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailView, setDetailView] = useState<'tasks' | 'assignments' | 'acceptance'>('tasks');
  const [planning, setPlanning] = useState<PlanningSetupStatus | null>(null);
  const [planningBusy, setPlanningBusy] = useState(false);

  const loadPlanning = useCallback(async () => {
    if (!projectId.trim()) {
      setError('请输入 projectId');
      return;
    }
    setPlanningBusy(true);
    setError('');
    try {
      setPlanning(await consoleRpc<PlanningSetupStatus>('workroom.profile.status', {
        projectId: projectId.trim(),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanningBusy(false);
    }
  }, [projectId]);

  const bootstrapPlanning = useCallback(async () => {
    if (!planning) return;
    setPlanningBusy(true);
    setError('');
    try {
      const next = await consoleRpc<PlanningSetupStatus>('workroom.profile.bootstrap', {
        operationId: `console:planning-bootstrap:${planning.projectId}:${Date.now()}`,
        projectId: planning.projectId,
        expectedRegistryRevision: planning.registryRevision,
        includeTools: planning.availableTools,
        includeSkills: planning.availableSkills,
      });
      setPlanning(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanningBusy(false);
    }
  }, [planning]);

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

  const loadRunDetail = useCallback(async (runId: string, runProjectId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/agent/workroom/runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(runProjectId)}`);
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
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Project control plane</span>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Workroom 控制台</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">查看 Journal + CAS Kernel 投影出的 Run、Task、Assignment 与验收门；普通聊天不会隐式创建 Workroom。</p>
        </div>
        <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">只读事实投影</span>
      </header>

      <details className="rounded-xl border bg-muted/20 open:bg-muted/10">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">运行与持久化配置 <span className="ml-2 text-xs font-normal text-muted-foreground">ai.sessions.useDatabase · 修改后需重启</span></summary>
        <div className="grid gap-4 border-t px-4 py-4 md:grid-cols-[1fr_1fr]">
          <div className="space-y-2 text-sm">
            <p className="font-medium">数据库 Journal（默认）</p>
            <p className="text-muted-foreground">`ai.sessions.useDatabase` 不为 false 时写入 `workroom_events`；Database Root Host 未就绪会阻止 candidate generation 发布。</p>
            <pre className="overflow-auto rounded-lg border bg-background p-3 text-xs">{'ai:\n  sessions:\n    useDatabase: true'}</pre>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-medium">原子文件 Journal</p>
            <p className="text-muted-foreground">显式设为 false 后使用 `.zhin/workroom-journal`。后端在进程启动时固定，热重载不会切换事实源。</p>
            <pre className="overflow-auto rounded-lg border bg-background p-3 text-xs">{'ai:\n  sessions:\n    useDatabase: false'}</pre>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground"><span>配置项属于 Agent session storage；切换 Journal 后端必须重启 Host，不能只做热重载。</span><a className="rounded-md border bg-background px-2.5 py-1.5 font-medium text-foreground hover:bg-muted" href="/config">打开配置编辑器</a></div>
      </details>

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

      <section className="rounded-xl border p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">规划与披露配置</h2>
            <p className="mt-1 text-xs text-muted-foreground">诊断 Catalog、Sponsor、Profile、Planning Policy 与 P12 模型披露 authority，并以当前 generation 的真实能力完成初始化。</p>
          </div>
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" disabled={planningBusy || !projectId.trim()} onClick={() => void loadPlanning()}>
            {planningBusy ? '检查中…' : '检查规划能力'}
          </button>
        </div>
        {planning ? (
          <div className="space-y-3 text-sm">
            <div className={`rounded-lg border p-3 ${planning.ready ? 'border-green-500/40 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
              <p className="font-medium">{planning.ready ? 'Workroom 编排已就绪，可以提交 /work' : 'Workroom 编排尚未就绪'}</p>
              <p className="mt-1 text-xs text-muted-foreground">principal: {planning.principalId ?? '未绑定'} · Profile: {planning.activeProfile?.revisionId ?? '未激活'} · Policy: {planning.planningPolicyReady ? '已发布' : '未发布'} · Disclosure: {planning.disclosureReady ? '已发布' : '未发布'}</p>
            </div>
            {planning.diagnostics.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-300">{planning.diagnostics.map(item => <li key={item}>{item}</li>)}</ul> : null}
            {!planning.principalId || !planning.trustedPackPublisher ? (
              <details className="rounded-lg border bg-muted/20">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium">首次配置所需 YAML（保存后重启）</summary>
                <pre className="overflow-auto border-t p-3 text-xs">{'http:\n  tokens:\n    - token: ${WORKROOM_SPONSOR_TOKEN}\n      scope: full\n      principalId: workroom-admin\nai:\n  workroom:\n    trustedPackPublishers:\n      - workroom-admin'}</pre>
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">重启后用 WORKROOM_SPONSOR_TOKEN 登录 Console，并在 Project sponsors 中加入 workroom-admin。</p>
              </details>
            ) : null}
            {!planning.disclosureReady && planning.modelProviderAlias && !planning.disclosureConfigReady ? (
              <details className="rounded-lg border bg-muted/20" open>
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium">模型处理方披露契约（保存后重启）</summary>
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">下面的占位符不能原样保存；必须按模型提供商合同与账号级设置填写。外部 Provider 只有在已禁止训练时才能初始化。</p>
                <pre className="overflow-auto border-t p-3 text-xs">{`ai:\n  workroom:\n    disclosure:\n      modelProviders:\n        ${planning.modelProviderAlias}:\n          endpoint: REPLACE_WITH_CONTRACTED_ENDPOINT\n          processingRegions: [REPLACE_WITH_CONTRACTED_REGION]\n          maxConfidentiality: project_internal\n          external: true\n          noTraining: REPLACE_WITH_PROVIDER_GUARANTEE\n          loggingMode: REPLACE_WITH_LOGGING_MODE\n          maximumRetentionSeconds: REPLACE_WITH_MAX_RETENTION_SECONDS\n          allowsRedisclosure: REPLACE_WITH_PROVIDER_GUARANTEE\n          supportsDeletion: REPLACE_WITH_PROVIDER_GUARANTEE`}</pre>
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">OpenRouter 还需在其 Privacy/Guardrail 中启用 ZDR，并禁止 data collection；YAML 声明不会替你修改第三方账号策略。</p>
              </details>
            ) : null}
            {!planning.ready && planning.catalogReady && planning.trustedPackPublisher && planning.projectSponsor ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{planning.activeProfile
                  ? planning.planningPolicyReady
                    ? '为当前 Project 发布加密的 P12 模型披露 authority。'
                    : '为当前 active Profile 发布默认 Planning Policy 与 P12 模型披露 authority。'
                  : `将当前 ${planning.availableAgents.length} 个 Agent、${planning.availableTools.length} 个 Tool、${planning.availableSkills.length} 个 Skill 固定进首个 Profile，并发布 Planning Policy 与 P12 披露 authority。`}</p>
                <button type="button" className="rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground" disabled={planningBusy} onClick={() => void bootstrapPlanning()}>
                  {planning.planningPolicyReady ? '初始化披露能力' : planning.activeProfile ? '补齐编排能力' : '初始化编排能力'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.5fr)]">
        <section className="rounded-xl border p-3 space-y-2">
          <h2 className="text-sm font-medium">Runs ({runs.length})</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">无数据</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {runs.map((item) => (
                <li key={item.runId} className={`rounded-lg border p-2 transition-colors ${selected?.runId === item.runId ? 'border-primary/40 bg-primary/5' : 'hover:bg-muted/30'}`}>
                  <button
                    type="button"
                    className="text-left w-full"
                    onClick={() => void loadRunDetail(item.runId, item.projectId)}
                  >
                    <div className="font-mono text-xs">{item.runId}</div>
                    <div className="mt-1 font-medium">{item.title || '(无标题)'}</div>
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

        <section className="rounded-xl border p-3 space-y-3">
          <h2 className="text-sm font-medium">Run 详情</h2>
          {!selected ? (
            <p className="text-sm text-muted-foreground">选择左侧 Run</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/25 p-3 text-sm">
                <div><div className="font-medium">{selected.title}</div><code className="text-xs text-muted-foreground">{selected.runId}</code></div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(selected.status)}`}>{selected.status}</span>
              </div>

              <dl className="grid grid-cols-2 overflow-hidden rounded-lg border text-sm sm:grid-cols-4">
                <div className="p-2.5"><dt className="text-xs text-muted-foreground">Sequence</dt><dd className="mt-0.5 font-medium tabular-nums">{selected.sequence}</dd></div>
                <div className="border-l p-2.5"><dt className="text-xs text-muted-foreground">Tasks</dt><dd className="mt-0.5 font-medium tabular-nums">{Object.keys(selected.tasks).length}</dd></div>
                <div className="border-t p-2.5 sm:border-l sm:border-t-0"><dt className="text-xs text-muted-foreground">Assignments</dt><dd className="mt-0.5 font-medium tabular-nums">{Object.keys(selected.assignments ?? {}).length}</dd></div>
                <div className="border-l border-t p-2.5 sm:border-t-0"><dt className="text-xs text-muted-foreground">Acceptance waits</dt><dd className="mt-0.5 font-medium tabular-nums">{Object.keys(selected.reviewerAssignments ?? {}).length + Object.keys(selected.sponsorGates ?? {}).length}</dd></div>
              </dl>

              <div className="flex gap-1 rounded-lg bg-muted/35 p-1" role="tablist" aria-label="Workroom 详情视图">
                {(['tasks', 'assignments', 'acceptance'] as const).map((view) => <button key={view} type="button" role="tab" aria-selected={detailView === view} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium ${detailView === view ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setDetailView(view)}>{view === 'tasks' ? '任务' : view === 'assignments' ? '执行分配' : '验收门'}</button>)}
              </div>

              {detailView === 'tasks' && <ul className="space-y-2 text-sm">
                {Object.values(selected.tasks).map((task) => (
                  <li key={task.key} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2"><div><code className="text-xs text-muted-foreground">{task.key}</code><div className="font-medium">{task.title}</div></div><span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(task.status)}`}>{task.status}</span></div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>rev {task.revision}</span><span>attempt {task.attempt}/{task.maxAttempts}</span>{task.currentAssignmentId ? <span>assignment {task.currentAssignmentId}</span> : null}</div>
                    {task.blockers?.map((blocker) => <div key={blocker.id} className="mt-2 rounded-md border border-amber-500/25 bg-amber-500/5 p-2 text-xs"><strong>{blocker.kind}</strong> · {blocker.reason}<div className="text-muted-foreground">owner {blocker.owner}</div></div>)}
                    {task.reportRef ? <div className="mt-2 break-words rounded bg-muted/35 p-2 font-mono text-xs">report: {task.reportRef}</div> : null}
                    {task.terminalReason ? <div className="mt-2 whitespace-pre-wrap text-xs text-red-600">{task.terminalReason}</div> : null}
                  </li>
                ))}
              </ul>}

              {detailView === 'assignments' && <ul className="space-y-2 text-sm">
                {Object.values(selected.assignments ?? {}).length === 0 ? <li className="py-8 text-center text-muted-foreground">暂无 Assignment</li> : Object.values(selected.assignments ?? {}).map((assignment) => (
                  <li key={assignment.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2"><div><code className="text-xs text-muted-foreground">{assignment.id}</code><div className="font-medium">{assignment.taskKey} · {assignment.role}</div></div><span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(assignment.status)}`}>{assignment.status}</span></div>
                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3"><span>owner {assignment.owner}</span><span>attempt {assignment.attempt}</span><span>lease {new Date(assignment.leaseExpiresAt).toLocaleString()}</span></div>
                    {assignment.latestProgress ? <div className="mt-2 rounded-md bg-muted/35 p-2 text-xs"><strong>Progress</strong> · {assignment.latestProgress.summary}{assignment.latestProgress.totalUnits ? <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><i className="block h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, ((assignment.latestProgress.completedUnits ?? 0) / assignment.latestProgress.totalUnits) * 100))}%` }} /></div> : null}</div> : null}
                  </li>
                ))}
              </ul>}

              {detailView === 'acceptance' && <ul className="space-y-2 text-sm">
                {[...Object.values(selected.reviewerAssignments ?? {}), ...Object.values(selected.sponsorGates ?? {})].length === 0 ? <li className="py-8 text-center text-muted-foreground">当前没有 Reviewer / Sponsor 等待项</li> : [...Object.values(selected.reviewerAssignments ?? {}), ...Object.values(selected.sponsorGates ?? {})].map((wait) => (
                  <li key={wait.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-2"><div><div className="font-medium">{wait.taskKey} · {wait.route}</div><code className="text-xs text-muted-foreground">{wait.id}</code></div><span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusTone(wait.status)}`}>{wait.status}</span></div><div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground"><span>risk {wait.riskTier}</span><span>owner {wait.owner}</span><span>deadline {new Date(wait.deadline).toLocaleString()}</span></div></li>
                ))}
              </ul>}

            </>
          )}
        </section>
      </div>
    </div>
  );
}

function statusTone(status: string): string {
  if (/completed|accepted|approved|passed|execution_completed/u.test(status)) return 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300';
  if (/failed|lost|rejected|expired/u.test(status)) return 'border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300';
  if (/blocked|replan|rework|cancell/u.test(status)) return 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300';
  return 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-300';
}
