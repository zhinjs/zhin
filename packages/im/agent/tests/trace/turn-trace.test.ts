import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TurnTraceCollector,
  createFileTurnTraceStore,
  createScopedTraceJournal,
  createTracingJournal,
  formatTurnTrace,
  noteTurnTrace,
  registerTurnTrace,
  scrubSecrets,
} from '../../src/trace/index.js';
import type { TurnEvent } from '../../src/event/turn-event.js';

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

function collector(time = clock()) {
  return new TurnTraceCollector({
    turnId: 'turn-1',
    sessionKey: 'im:qq:bot:group:42',
    principal: { subjectId: 'u-7', displayName: 'Alice', roles: ['user'] },
  }, time.now);
}

describe('TurnTraceCollector', () => {
  it('captures every trace field of a turn', () => {
    const time = clock();
    const trace = collector(time);
    const events: TurnEvent[] = [
      { type: 'turn_start', sessionId: 'im:qq:bot:group:42', turnId: 'turn-1' },
      { type: 'iteration_start', iteration: 1, maxIterations: 6 },
      { type: 'usage', usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 } },
      { type: 'tool_call', toolName: 'web_search', args: { query: 'zhin' }, toolUseId: 't1' },
    ];
    for (const event of events) trace.record(event);
    time.advance(40);
    trace.record({ type: 'tool_result', toolName: 'web_search', output: 'x'.repeat(512), durationMs: 40, toolUseId: 't1' });
    trace.record({ type: 'tool_call', toolName: 'read_file', args: { path: 'a.txt' }, toolUseId: 't2' });
    trace.record({ type: 'tool_failed', toolName: 'read_file', toolUseId: 't2', error: 'ENOENT', durationMs: 3 });
    trace.record({ type: 'tool_denied', toolName: 'bash', toolUseId: 't3', policy: 'group_member', reason: '群成员不能执行命令' });
    trace.note({ kind: 'budget_extended', from: 6, to: 16 });
    trace.note({ kind: 'continuation', index: 1 });
    trace.record({ type: 'usage', usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 } });
    time.advance(10);
    trace.record({ type: 'error', error: new Error('provider down'), recoverable: false, code: 'provider_unavailable' });

    const snapshot = trace.snapshot();
    expect(snapshot).toMatchObject({
      turn_id: 'turn-1',
      session_key: 'im:qq:bot:group:42',
      principal: { subject_id: 'u-7', display_name: 'Alice', roles: ['user'] },
      started_at: 1_000,
      ended_at: 1_050,
      duration_ms: 50,
      usage: { prompt_tokens: 320, completion_tokens: 50, total_tokens: 370 },
      budget: { extensions: [{ from: 6, to: 16 }], continuations: 1 },
      termination: { status: 'failed', code: 'provider_unavailable', reason: 'provider down' },
    });
    expect(snapshot.model_calls).toHaveLength(2);
    expect(snapshot.tool_calls).toEqual([
      expect.objectContaining({ tool_name: 'web_search', status: 'ok', duration_ms: 40, result_size: 512, args_summary: '{"query":"zhin"}' }),
      expect.objectContaining({ tool_name: 'read_file', status: 'failed', error: 'ENOENT' }),
      expect.objectContaining({ tool_name: 'bash', status: 'denied', policy: 'group_member' }),
    ]);
    expect(snapshot.timeline.at(-1)).toMatchObject({ kind: 'end' });
    // Raw tool output is never stored, only its size.
    expect(JSON.stringify(snapshot)).not.toContain('x'.repeat(100));
  });

  it('records how a turn was admitted behind other turns (#725)', () => {
    const trace = collector();
    trace.note({ kind: 'admission', queued_ms: 1_200, merged_messages: 3, superseded_previous: true });
    expect(trace.snapshot().timeline.at(-1)).toMatchObject({
      kind: 'admission',
      detail: "queued 1200ms, merged 3 messages, replaced the sender's unanswered turn",
    });
  });

  it('ignores events after the terminal and closes running tools', () => {
    const trace = collector();
    trace.record({ type: 'tool_call', toolName: 'slow', args: {}, toolUseId: 't1' });
    trace.record({ type: 'turn_cancelled', reason: 'superseded by new message', code: 'superseded' });
    trace.record({ type: 'turn_end', output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    const snapshot = trace.snapshot();
    expect(snapshot.termination).toMatchObject({ status: 'cancelled', code: 'superseded' });
    expect(snapshot.tool_calls[0]?.status).toBe('cancelled');
  });

  it('finalizes a turn that never emitted a terminal event', () => {
    const trace = collector();
    trace.finalize();
    expect(trace.snapshot().termination.status).toBe('unknown');
  });
});

describe('sub-agent nesting', () => {
  it('nests child turn events routed through a scoped journal', async () => {
    const parent = collector();
    const committed: TurnEvent[] = [];
    const journal = createTracingJournal({ append: (event) => { committed.push(event); } }, parent);
    const childJournal = createScopedTraceJournal(journal, { turnId: 'turn-1:subagent:1', sessionKey: 's#subagent:1' });

    await journal.append({ type: 'tool_call', toolName: 'run_subagent', args: { task: 'scan' }, toolUseId: 'p1' });
    await childJournal.append({ type: 'tool_call', toolName: 'grep', args: { pattern: 'TODO' }, toolUseId: 'c1' });
    await childJournal.append({ type: 'tool_result', toolName: 'grep', output: 'hit', durationMs: 5, toolUseId: 'c1' });
    noteTurnTrace('turn-1:subagent:1', { kind: 'budget_extended', from: 4, to: 8 }); // not registered: no-op
    const release = registerTurnTrace(parent);
    noteTurnTrace('turn-1:subagent:1', { kind: 'budget_extended', from: 4, to: 8 });
    release();
    await journal.append({ type: 'tool_result', toolName: 'run_subagent', output: 'done', durationMs: 50, toolUseId: 'p1' });
    parent.record({ type: 'turn_end', output: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    parent.finalize();

    // The real journal still receives every event, child ones included.
    expect(committed).toHaveLength(4);
    const snapshot = parent.snapshot();
    expect(snapshot.tool_calls.map(tool => tool.tool_name)).toEqual(['run_subagent']);
    expect(snapshot.subagents).toHaveLength(1);
    const child = snapshot.subagents[0]!;
    expect(child).toMatchObject({
      turn_id: 'turn-1:subagent:1',
      session_key: 's#subagent:1',
      principal: { subject_id: 'u-7' },
      budget: { extensions: [{ from: 4, to: 8 }] },
      termination: { status: 'unknown' },
    });
    expect(child.tool_calls).toEqual([expect.objectContaining({ tool_name: 'grep', status: 'ok', result_size: 3 })]);
    expect(formatTurnTrace(snapshot)).toContain('子 agent:');
  });

  it('records subagent task lifecycle events', () => {
    const trace = collector();
    trace.record({ type: 'subagent_start', taskId: 'task-1', agentName: 'coder', description: 'fix bug' });
    trace.record({ type: 'subagent_end', taskId: 'task-1', status: 'error', result: 'timed out' });
    expect(trace.snapshot().subagent_tasks).toEqual([
      { task_id: 'task-1', agent_name: 'coder', description: 'fix bug', status: 'error', result_summary: 'timed out' },
    ]);
  });
});

describe('redaction', () => {
  it('redacts secret-named arguments and inline credentials', () => {
    const trace = collector();
    trace.record({
      type: 'tool_call',
      toolName: 'http_request',
      args: { url: 'https://api.example.com', headers: { Authorization: 'Bearer abc.def.ghi' }, api_key: 'k-123' },
      toolUseId: 't1',
    });
    trace.record({
      type: 'tool_failed',
      toolName: 'http_request',
      toolUseId: 't1',
      error: 'request failed with Authorization: Bearer sk-livesecretvalue1234 and password=hunter2',
      durationMs: 1,
    });
    const text = JSON.stringify(trace.snapshot());
    expect(text).not.toContain('abc.def.ghi');
    expect(text).not.toContain('k-123');
    expect(text).not.toContain('sk-livesecretvalue1234');
    expect(text).not.toContain('hunter2');
    expect(text).toContain('[redacted]');
  });

  it('scrubs common token shapes in free text', () => {
    expect(scrubSecrets('token ghp_abcdefghijklmnop123 used')).toBe('token [redacted] used');
    expect(scrubSecrets('{"refresh_token":"1//abc"}')).toBe('{"refresh_token":"[redacted]"}');
    expect(scrubSecrets('plain text stays')).toBe('plain text stays');
  });
});

describe('file store', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('keeps only the most recent traces and finds by id or prefix', async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhin-trace-'));
    const file = join(dir, 'data', 'agent-traces', 'recent.json');
    const store = createFileTurnTraceStore(file, { limit: 2 });
    for (const id of ['alpha-1', 'beta-2', 'gamma-3']) {
      const trace = new TurnTraceCollector({ turnId: id, sessionKey: 's' });
      trace.finalize({ status: 'completed' });
      await store.save(trace.snapshot());
    }
    expect((await store.list()).map(trace => trace.turn_id)).toEqual(['beta-2', 'gamma-3']);
    expect((await store.latest())?.turn_id).toBe('gamma-3');
    expect((await store.find('beta'))?.turn_id).toBe('beta-2');
    expect(await store.find('alpha-1')).toBeUndefined();
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);
  });

  it('treats a missing or corrupt file as empty', async () => {
    dir = await mkdtemp(join(tmpdir(), 'zhin-trace-'));
    const file = join(dir, 'recent.json');
    const store = createFileTurnTraceStore(file);
    expect(await store.latest()).toBeUndefined();
    await writeFile(file, '{not json');
    expect(await store.list()).toEqual([]);
  });
});
