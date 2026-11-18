/**
 * #1250 b52: a job's `action.agent` set through the Assistant handle (what `zhin schedule add
 * --agent` / `set-agent` and the Console reach) is the binding the scheduled turn runs on.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssistantScheduleRuntime } from '../../../src/plugin-runtime/host/assistant-runtime.js';
import { AgentBindingRegistry } from '../../../src/config/agent-binding-registry.js';
import { DEFAULT_CONFIG } from '../../../src/config/index.js';

const dirs: string[] = [];
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(bindings: Record<string, object> = { zhin: {}, news: {} }) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'zhin-schedule-agent-'));
  dirs.push(projectRoot);
  const execute = vi.fn(async (_owner: unknown, _request: unknown, _selection: { binding: { name: string }; agent?: string }) => ({
    status: 'completed' as const, output: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  }));
  const harness = { remaining: () => ({ modelCalls: 0 }), charge: async () => undefined };
  const mailbox = {
    admit: vi.fn(async () => ({ kind: 'run', signal: new AbortController().signal, mail: { id: 'm1' }, batch: [], harness, release: async () => undefined })),
    settle: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
  };
  const agent = {
    config: DEFAULT_CONFIG,
    hostMailbox: new Proxy(mailbox, { get: (target, key) => (target as Record<PropertyKey, unknown>)[key] ?? (async () => undefined) }),
    getControlPlane: () => undefined,
    getDecisionEvents: () => undefined,
    getEventEmitter: () => ({ dispatch: async () => undefined }),
  };
  const registry = new AgentBindingRegistry(bindings);
  const service = { getBindingRegistry: () => registry };
  const im = { permissionHost: { currentSenderRoles: () => undefined } };
  const schedule = createAssistantScheduleRuntime(
    agent as never, service as never, { execute } as never, im as never, projectRoot,
    { enabled: true } as never, { record: () => undefined } as never,
  );
  disposers.push(schedule.dispose);
  return { schedule, execute, jobs: schedule.assistantRuntime!.jobs };
}

const atSoon = () => ({ kind: 'at' as const, atMs: Date.now() + 150, deleteAfterRun: true });

describe('scheduled job Agent (#1250 b52)', () => {
  it('lists the configured Agents and runs a job on the Agent it names', async () => {
    const { schedule, execute, jobs } = setup();
    await schedule.start();
    expect(jobs.agents?.()).toEqual(['zhin', 'news']);
    await jobs.add({ id: 'brief', enabled: true, schedule: atSoon(), action: { kind: 'agent', prompt: '早报', agent: 'news' }, notify: { channel: 'silent' } });
    await vi.waitFor(() => expect(execute).toHaveBeenCalled(), { timeout: 3000 });
    expect(execute.mock.calls[0]![2]).toMatchObject({ binding: { name: 'news' }, agent: 'news' });
  });

  it('a job without an Agent runs on the default binding, as before', async () => {
    const { schedule, execute, jobs } = setup();
    await schedule.start();
    await jobs.add({ id: 'plain', enabled: true, schedule: atSoon(), action: { kind: 'agent', prompt: '天气' }, notify: { channel: 'silent' } });
    await vi.waitFor(() => expect(execute).toHaveBeenCalled(), { timeout: 3000 });
    expect(execute.mock.calls[0]![2].binding.name).toBe('zhin');
    expect(execute.mock.calls[0]![2]).not.toHaveProperty('agent');
  });

  it('setAgent changes the Agent of the next run, and clearing it restores the default', async () => {
    const { schedule, execute, jobs } = setup();
    await schedule.start();
    await jobs.add({ id: 'later', enabled: true, schedule: { kind: 'every', everyMs: 3_600_000 }, action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' } });
    const changed = await jobs.setAgent!('later', 'news');
    expect(changed?.action).toEqual({ kind: 'agent', prompt: 'p', agent: 'news' });
    expect((await jobs.list()).find(job => job.id === 'later')?.action).toEqual({ kind: 'agent', prompt: 'p', agent: 'news' });
    const cleared = await jobs.setAgent!('later', undefined);
    expect(cleared?.action).toEqual({ kind: 'agent', prompt: 'p' });
    expect(await jobs.setAgent!('ghost', 'news')).toBeNull();
    await jobs.setAgent!('later', 'news');
    await jobs.add({ id: 'later', enabled: true, schedule: atSoon(), action: (await jobs.list()).find(job => job.id === 'later')!.action, notify: { channel: 'silent' } });
    await vi.waitFor(() => expect(execute).toHaveBeenCalled(), { timeout: 3000 });
    expect(execute.mock.calls[0]![2]).toMatchObject({ binding: { name: 'news' }, agent: 'news' });
  });

  it('an already registered timer runs on the new Agent after setAgent, without being registered again', async () => {
    const { schedule, execute, jobs } = setup();
    await schedule.start();
    await jobs.add({ id: 'armed', enabled: true, schedule: { kind: 'at', atMs: Date.now() + 400, deleteAfterRun: true }, action: { kind: 'agent', prompt: 'p' }, notify: { channel: 'silent' } });
    const add = vi.spyOn(jobs, 'add');
    await jobs.setAgent!('armed', 'news');
    await vi.waitFor(() => expect(execute).toHaveBeenCalled(), { timeout: 3000 });
    expect(execute.mock.calls[0]![2]).toMatchObject({ binding: { name: 'news' }, agent: 'news' });
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses to change a profile routine (re-declared from the profile on every start) and a heartbeat job', async () => {
    const { schedule, jobs } = setup();
    await schedule.start();
    await jobs.add({ id: 'assistant-profile-morning-brief', enabled: true, schedule: { kind: 'every', everyMs: 3_600_000 },
      action: { kind: 'agent', prompt: '早报' }, notify: { channel: 'silent' }, source: 'profile' });
    await expect(jobs.setAgent!('assistant-profile-morning-brief', 'news')).rejects.toMatchObject({
      code: 'schedule_agent_profile', message: expect.stringContaining('assistant.profile.yml'),
    });
    expect((await jobs.list()).find(job => job.id === 'assistant-profile-morning-brief')?.action).toEqual({ kind: 'agent', prompt: '早报' });
    await jobs.add({ id: 'beat', enabled: true, schedule: { kind: 'every', everyMs: 3_600_000 }, action: { kind: 'heartbeat', prompt: 'p' }, notify: { channel: 'silent' } });
    await expect(jobs.setAgent!('beat', 'news')).rejects.toMatchObject({ code: 'schedule_agent_heartbeat' });
  });

  it('a job whose Agent was removed from ai.agents fails its run visibly and never runs on another Agent', async () => {
    const { schedule, execute, jobs } = setup({ zhin: {} });
    await schedule.start();
    expect(jobs.agents?.()).toEqual(['zhin']);
    await jobs.add({ id: 'orphan', enabled: true, schedule: { kind: 'every', everyMs: 1000 }, action: { kind: 'agent', prompt: 'p', agent: 'news' }, notify: { channel: 'silent' } });
    await vi.waitFor(async () => {
      expect((await jobs.list()).find(job => job.id === 'orphan')?.state).toMatchObject({ lastStatus: 'error', lastError: expect.stringContaining('news') });
    }, { timeout: 3000 });
    expect(execute).not.toHaveBeenCalled();
  });
});
