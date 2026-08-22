import {
  buildSandboxSessionKey,
  buildAgentRunReport,
  deriveAgentRunSteps,
  deriveTaskRuns,
  deriveWorkbenchArtifacts,
  loadCachedAgentTrace,
  mergeTraceSnapshot,
  presentTraceEvent,
  summarizeTrace,
  saveCachedAgentTrace,
  type AgentTraceStorage,
  type AgentTraceSnapshot,
} from './agentTrace.js';

const snapshot: AgentTraceSnapshot = {
  sessionKey: 'sandbox:bot:private:user',
  latestSequence: 3,
  activeTurnIds: ['turn-1'],
  events: [
    { sequence: 1, recordedAt: 1, sessionKey: 'sandbox:bot:private:user', turnId: 'turn-1', type: 'turn_start', data: {} },
    { sequence: 2, recordedAt: 2, sessionKey: 'sandbox:bot:private:user', turnId: 'turn-1', type: 'tool_call', data: { toolName: 'lookup' } },
    { sequence: 3, recordedAt: 3, sessionKey: 'sandbox:bot:private:user', turnId: 'turn-1', type: 'usage', data: { usage: { totalTokens: 218 } } },
  ],
};

class MemoryTraceStorage implements AgentTraceStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('sandbox agent trace helpers', () => {
  it('builds the canonical IM session key', () => {
    expect(buildSandboxSessionKey('sandbox-bot', 'group', 'planning-room')).toBe('sandbox:sandbox-bot:group:planning-room');
  });

  it('merges incremental trace snapshots without duplicates', () => {
    const merged = mergeTraceSnapshot(snapshot, {
      ...snapshot,
      latestSequence: 4,
      activeTurnIds: [],
      events: [snapshot.events[2], { ...snapshot.events[0], sequence: 4, recordedAt: 4, type: 'turn_end' }],
    });
    expect(merged.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(merged.activeTurnIds).toEqual([]);
  });

  it('persists bounded task history across browser and Host restarts', () => {
    const storage = new MemoryTraceStorage();
    expect(saveCachedAgentTrace(snapshot, storage)).toBe(true);
    const restored = loadCachedAgentTrace(snapshot.sessionKey, storage);
    expect(restored).toEqual(snapshot);

    const afterHostRestart = mergeTraceSnapshot(restored, {
      sessionKey: snapshot.sessionKey,
      latestSequence: 1,
      activeTurnIds: ['turn-new'],
      events: [{
        sequence: 1,
        recordedAt: 100,
        sessionKey: snapshot.sessionKey,
        turnId: 'turn-new',
        type: 'turn_start',
        data: {},
      }],
    });
    expect(afterHostRestart.events.map((event) => event.turnId)).toEqual([
      'turn-1', 'turn-1', 'turn-1', 'turn-new',
    ]);
    expect(afterHostRestart.latestSequence).toBe(1);
  });

  it('summarizes operational metrics and presents tool events', () => {
    expect(summarizeTrace(snapshot)).toEqual({ eventCount: 3, toolCount: 1, tokenCount: 218, problemCount: 0, activeTurns: 1 });
    expect(presentTraceEvent(snapshot.events[1])).toMatchObject({ title: '调用 lookup', tone: 'tool' });
  });

  it('derives stable task lifecycle states from trace terminals', () => {
    const runs = deriveTaskRuns({
      sessionKey: snapshot.sessionKey,
      latestSequence: 9,
      activeTurnIds: ['turn-running'],
      events: [
        { sequence: 1, recordedAt: 10, sessionKey: snapshot.sessionKey, turnId: 'turn-done', type: 'turn_start', data: { sourceMessageId: 'msg-done' } },
        { sequence: 2, recordedAt: 20, sessionKey: snapshot.sessionKey, turnId: 'turn-done', type: 'tool_call', data: { toolName: 'write_file' } },
        { sequence: 3, recordedAt: 30, sessionKey: snapshot.sessionKey, turnId: 'turn-done', type: 'usage', data: { usage: { totalTokens: 144 } } },
        { sequence: 4, recordedAt: 40, sessionKey: snapshot.sessionKey, turnId: 'turn-done', type: 'turn_end', data: {} },
        { sequence: 5, recordedAt: 50, sessionKey: snapshot.sessionKey, turnId: 'turn-failed', type: 'turn_start', data: {} },
        { sequence: 6, recordedAt: 60, sessionKey: snapshot.sessionKey, turnId: 'turn-failed', type: 'error', data: { error: { message: 'boom' } } },
        { sequence: 7, recordedAt: 70, sessionKey: snapshot.sessionKey, turnId: 'turn-running', type: 'turn_start', data: {} },
        { sequence: 8, recordedAt: 80, sessionKey: snapshot.sessionKey, turnId: 'turn-running', type: 'iteration_start', data: {} },
        { sequence: 9, recordedAt: 45, sessionKey: snapshot.sessionKey, turnId: 'turn-incomplete', type: 'turn_start', data: {} },
      ],
    });
    expect(runs.map((run) => ({ id: run.turnId, status: run.status }))).toEqual([
      { id: 'turn-running', status: 'running' },
      { id: 'turn-failed', status: 'failed' },
      { id: 'turn-incomplete', status: 'failed' },
      { id: 'turn-done', status: 'completed' },
    ]);
    expect(runs[3]).toMatchObject({ sourceMessageId: 'msg-done', toolCount: 1, tokenCount: 144, durationMs: 30 });
  });

  it('projects file edits and test commands into workbench artifacts', () => {
    const artifacts = deriveWorkbenchArtifacts({
      sessionKey: snapshot.sessionKey,
      latestSequence: 4,
      activeTurnIds: [],
      events: [
        { sequence: 1, recordedAt: 1, sessionKey: snapshot.sessionKey, turnId: 'turn-1', type: 'tool_call', data: {
          toolName: 'edit_file', toolUseId: 'edit-1', args: {
            file_path: '/workspace/src/app.ts', old_string: 'const draft = true', new_string: 'const draft = false',
          },
        } },
        { sequence: 2, recordedAt: 2, sessionKey: snapshot.sessionKey, turnId: 'turn-1', type: 'tool_result', data: {
          toolName: 'edit_file', toolUseId: 'edit-1', output: 'Edited /workspace/src/app.ts', durationMs: 8,
        } },
        { sequence: 3, recordedAt: 3, sessionKey: snapshot.sessionKey, turnId: 'turn-1', type: 'tool_call', data: {
          toolName: 'bash', toolUseId: 'test-1', args: { command: 'pnpm test' },
        } },
        { sequence: 4, recordedAt: 4, sessionKey: snapshot.sessionKey, turnId: 'turn-1', type: 'tool_result', data: {
          toolName: 'bash', toolUseId: 'test-1', output: '12 tests passed', durationMs: 42,
        } },
      ],
    });
    expect(artifacts).toHaveLength(2);
    const file = artifacts.find((artifact) => artifact.kind === 'file-change');
    const test = artifacts.find((artifact) => artifact.kind === 'test');
    expect(file).toMatchObject({ status: 'completed', path: '/workspace/src/app.ts' });
    expect(file?.diff).toContain('+++ b/workspace/src/app.ts');
    expect(file?.diff).toContain('- const draft = true');
    expect(file?.diff).toContain('+ const draft = false');
    expect(test).toMatchObject({ status: 'completed', title: 'pnpm test', detail: '12 tests passed' });
  });

  it('does not cross-wire reused tool ids across turns or runtime generations', () => {
    const events = [
      { runtimeId: 'runtime-old', sequence: 1, recordedAt: 1, sessionKey: snapshot.sessionKey, turnId: 'turn-reused', type: 'tool_call', data: { toolName: 'bash', toolUseId: 'call_1', args: { command: 'pnpm test' } } },
      { runtimeId: 'runtime-old', sequence: 2, recordedAt: 2, sessionKey: snapshot.sessionKey, turnId: 'turn-reused', type: 'tool_result', data: { toolName: 'bash', toolUseId: 'call_1', output: 'old result' } },
      { runtimeId: 'runtime-new', sequence: 1, recordedAt: 3, sessionKey: snapshot.sessionKey, turnId: 'turn-reused', type: 'tool_call', data: { toolName: 'bash', toolUseId: 'call_1', args: { command: 'pnpm build' } } },
      { runtimeId: 'runtime-new', sequence: 2, recordedAt: 4, sessionKey: snapshot.sessionKey, turnId: 'turn-reused', type: 'tool_result', data: { toolName: 'bash', toolUseId: 'call_1', output: 'new result' } },
    ] satisfies AgentTraceSnapshot['events'];
    const artifacts = deriveWorkbenchArtifacts({
      runtimeId: 'runtime-new',
      sessionKey: snapshot.sessionKey,
      latestSequence: 2,
      activeTurnIds: [],
      events,
    });
    expect(artifacts.map((artifact) => artifact.detail)).toEqual(['new result', 'old result']);
    expect(new Set(artifacts.map((artifact) => artifact.id)).size).toBe(2);
    expect(deriveTaskRuns({
      runtimeId: 'runtime-new', sessionKey: snapshot.sessionKey, latestSequence: 2, activeTurnIds: [], events,
    }).map((run) => run.id)).toEqual(['runtime-new:turn-reused', 'runtime-old:turn-reused']);
  });

  it('projects a turn into readable, correlated workbench steps', () => {
    const runSnapshot: AgentTraceSnapshot = {
      sessionKey: snapshot.sessionKey,
      latestSequence: 8,
      activeTurnIds: [],
      events: [
        { sequence: 1, recordedAt: 10, sessionKey: snapshot.sessionKey, turnId: 'turn-report', type: 'turn_start', data: {} },
        { sequence: 2, recordedAt: 12, sessionKey: snapshot.sessionKey, turnId: 'turn-report', type: 'capability_resolution', data: { tools: ['bash'], skills: [] } },
        { sequence: 3, recordedAt: 14, sessionKey: snapshot.sessionKey, turnId: 'turn-report', type: 'iteration_start', data: { iteration: 1, maxIterations: 8 } },
        { sequence: 4, recordedAt: 16, sessionKey: snapshot.sessionKey, turnId: 'turn-report', type: 'tool_call', data: { toolName: 'bash', toolUseId: 'call-1', args: { command: 'pnpm test' } } },
        { sequence: 5, recordedAt: 30, sessionKey: snapshot.sessionKey, turnId: 'turn-report', type: 'tool_result', data: { toolName: 'bash', toolUseId: 'call-1', output: '18 tests passed', durationMs: 14 } },
        { sequence: 6, recordedAt: 32, sessionKey: snapshot.sessionKey, turnId: 'turn-report', type: 'tool_call', data: { toolName: 'bash', toolUseId: 'call-2', args: { command: 'pnpm lint' } } },
        { sequence: 7, recordedAt: 40, sessionKey: snapshot.sessionKey, turnId: 'turn-report', type: 'tool_failed', data: { toolName: 'bash', toolUseId: 'call-2', error: 'lint failed', durationMs: 8 } },
        { sequence: 8, recordedAt: 42, sessionKey: snapshot.sessionKey, turnId: 'turn-report', type: 'error', data: { error: 'lint failed' } },
      ],
    };

    expect(deriveAgentRunSteps(runSnapshot, { turnId: 'turn-report' })).toEqual([
      expect.objectContaining({ title: '接收任务', status: 'completed' }),
      expect.objectContaining({ title: '准备运行能力', detail: '1 tools · 0 skills', status: 'completed' }),
      expect.objectContaining({ title: '推理迭代 1', status: 'completed' }),
      expect.objectContaining({ title: '运行 bash', detail: 'pnpm test', status: 'completed', durationMs: 14 }),
      expect.objectContaining({ title: '运行 bash', detail: 'pnpm lint', status: 'failed', durationMs: 8 }),
      expect.objectContaining({ title: '任务失败', detail: 'lint failed', status: 'failed' }),
    ]);
  });

  it('does not leave interrupted work looking active after a terminal event', () => {
    const interrupted: AgentTraceSnapshot = {
      sessionKey: snapshot.sessionKey,
      latestSequence: 3,
      activeTurnIds: [],
      events: [
        { sequence: 1, recordedAt: 1, sessionKey: snapshot.sessionKey, turnId: 'turn-stop', type: 'turn_start', data: {} },
        { sequence: 2, recordedAt: 2, sessionKey: snapshot.sessionKey, turnId: 'turn-stop', type: 'tool_call', data: { toolName: 'bash', toolUseId: 'slow', args: { command: 'pnpm test' } } },
        { sequence: 3, recordedAt: 3, sessionKey: snapshot.sessionKey, turnId: 'turn-stop', type: 'turn_cancelled', data: { reason: 'user stopped' } },
      ],
    };
    expect(deriveAgentRunSteps(interrupted, { turnId: 'turn-stop' })).toEqual([
      expect.objectContaining({ title: '接收任务', status: 'completed' }),
      expect.objectContaining({ title: '运行 bash', status: 'cancelled' }),
      expect.objectContaining({ title: '任务已停止', status: 'cancelled' }),
    ]);
  });

  it('preserves a completed tool result while a live turn waits for the model', () => {
    const live: AgentTraceSnapshot = {
      sessionKey: snapshot.sessionKey,
      latestSequence: 3,
      activeTurnIds: ['turn-live'],
      events: [
        { sequence: 1, recordedAt: 1, sessionKey: snapshot.sessionKey, turnId: 'turn-live', type: 'turn_start', data: {} },
        { sequence: 2, recordedAt: 2, sessionKey: snapshot.sessionKey, turnId: 'turn-live', type: 'tool_call', data: { toolName: 'bash', toolUseId: 'done', args: { command: 'pnpm test' } } },
        { sequence: 3, recordedAt: 3, sessionKey: snapshot.sessionKey, turnId: 'turn-live', type: 'tool_result', data: { toolName: 'bash', toolUseId: 'done', durationMs: 1 } },
      ],
    };
    const steps = deriveAgentRunSteps(live, { turnId: 'turn-live' });
    expect(steps.at(-2)).toMatchObject({ title: '运行 bash', status: 'completed' });
    expect(steps.at(-1)).toMatchObject({ title: '等待 Agent 返回', status: 'running' });
  });

  it('builds a portable Markdown report for the selected run', () => {
    const reportSnapshot: AgentTraceSnapshot = {
      sessionKey: snapshot.sessionKey,
      latestSequence: 4,
      activeTurnIds: [],
      events: [
        { sequence: 1, recordedAt: 1_000, sessionKey: snapshot.sessionKey, turnId: 'turn-export', type: 'turn_start', data: {} },
        { sequence: 2, recordedAt: 1_100, sessionKey: snapshot.sessionKey, turnId: 'turn-export', type: 'tool_call', data: { toolName: 'edit_file', toolUseId: 'edit-1', args: { file_path: '/workspace/app.ts', old_string: 'false', new_string: 'true' } } },
        { sequence: 3, recordedAt: 1_120, sessionKey: snapshot.sessionKey, turnId: 'turn-export', type: 'tool_result', data: { toolName: 'edit_file', toolUseId: 'edit-1', output: 'done', durationMs: 20 } },
        { sequence: 4, recordedAt: 1_140, sessionKey: snapshot.sessionKey, turnId: 'turn-export', type: 'turn_end', data: {} },
      ],
    };

    const report = buildAgentRunReport(reportSnapshot, {
      run: { turnId: 'turn-export' },
      sessionName: '代码审查',
      taskPrompt: '请修复 `app.ts`',
      workingDirectory: '/workspace',
      safetyMode: 'workspace-write',
      approvalMode: 'ask',
      networkAccess: false,
    });

    expect(report).toContain('# Agent 运行报告');
    expect(report).toContain('**状态：** 已完成');
    expect(report).toContain('请修复 `app.ts`');
    expect(report).toContain('运行 `edit_file`');
    expect(report).toContain('`/workspace/app.ts`');
    expect(report).toContain('```diff');
    expect(report).toContain('+ true');
  });

  it('uses longer Markdown fences for untrusted report content', () => {
    const report = buildAgentRunReport({
      sessionKey: snapshot.sessionKey,
      latestSequence: 3,
      activeTurnIds: [],
      events: [
        { sequence: 1, recordedAt: 1, sessionKey: snapshot.sessionKey, turnId: 'turn-fence', type: 'turn_start', data: {} },
        { sequence: 2, recordedAt: 2, sessionKey: snapshot.sessionKey, turnId: 'turn-fence', type: 'tool_call', data: { toolName: 'bash', toolUseId: 'fence', args: { command: 'echo report' } } },
        { sequence: 3, recordedAt: 3, sessionKey: snapshot.sessionKey, turnId: 'turn-fence', type: 'tool_result', data: { toolName: 'bash', toolUseId: 'fence', output: '```\n<img src=x onerror=alert(1)>\n```' } },
      ],
    }, { run: { turnId: 'turn-fence' }, taskPrompt: '```\n# injected\n```' });
    expect(report).toContain('````text\n```\n# injected\n```\n````');
    expect(report).toContain('````text\n```\n<img src=x onerror=alert(1)>\n```\n````');
  });
});
