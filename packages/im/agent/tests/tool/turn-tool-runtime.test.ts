import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { TurnEvent } from '../../src/event/turn-event.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';

describe('TurnToolRuntime', () => {
  it('records a pre-aborted invocation as cancelled without running policies or the tool', async () => {
    const controller = new AbortController();
    controller.abort('deadline exceeded');
    const execute = vi.fn(async () => 'unreachable');
    const { turn, events } = fixture({ signal: controller.signal });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'always')]);

    await expect(runtime.execute('danger', {}, 'call-0')).resolves.toEqual({
      status: 'cancelled',
      reason: 'deadline exceeded',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_cancelled']);
  });

  it('fails closed before execute when approval is required but unavailable', async () => {
    const execute = vi.fn(async () => 'unsafe');
    const { turn, events } = fixture();
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'always')]);

    await expect(runtime.execute('danger', {}, 'call-1')).resolves.toEqual({
      status: 'denied',
      policy: 'approval',
      reason: 'approval required but ApprovalPort unavailable',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('denies canonical file writes for a non-owner before execution', async () => {
    const execute = vi.fn(async () => 'unsafe write');
    const { turn, events } = fixture();
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'write_file')]);

    await expect(runtime.execute('write_file', { path: '/tmp/output.txt' }, 'call-file')).resolves.toMatchObject({
      status: 'denied',
      policy: 'file-permission-matrix',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('denies canonical sensitive file reads for a regular user', async () => {
    const execute = vi.fn(async () => 'sensitive contents');
    const { turn, events } = fixture();
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'read_file')]);

    await expect(runtime.execute('read_file', { path: '/etc/passwd' }, 'call-read')).resolves.toMatchObject({
      status: 'denied',
      policy: 'file-permission-matrix',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('denies canonical Bash mutations for a regular user', async () => {
    const execute = vi.fn(async () => 'deleted');
    const { turn, events } = fixture();
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'bash')]);

    await expect(runtime.execute('bash', { command: 'rm /tmp/output.txt' }, 'call-bash')).resolves.toMatchObject({
      status: 'denied',
      policy: 'bash-file-permission',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('denies canonical Bash reads of sensitive paths for a regular user', async () => {
    const execute = vi.fn(async () => 'sensitive contents');
    const { turn, events } = fixture();
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'bash')]);

    await expect(runtime.execute('bash', { command: 'cat /etc/passwd' }, 'call-bash-read')).resolves.toMatchObject({
      status: 'denied',
      policy: 'bash-sensitive-read',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('denies canonical network tools when the Turn has no network authority', async () => {
    const execute = vi.fn(async () => 'remote response');
    const { turn, events } = fixture();
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'web_fetch')]);

    await expect(runtime.execute(
      'web_fetch',
      { url: 'https://api.example.com/data' },
      'call-network',
    )).resolves.toMatchObject({
      status: 'denied',
      policy: 'network-access',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('allows only allowlisted HTTPS targets under canonical network authority', async () => {
    const execute = vi.fn(async () => 'remote response');
    const { turn } = fixture({
      network: { enabled: true, httpsOnly: true, allowedDomains: ['api.example.com'] },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'web_fetch')]);

    await expect(runtime.execute(
      'web_fetch',
      { url: 'https://api.example.com/data' },
      'call-network-allowed',
    )).resolves.toMatchObject({ status: 'completed' });
    await expect(runtime.execute(
      'web_fetch',
      { url: 'http://api.example.com/data' },
      'call-network-http',
    )).resolves.toMatchObject({ status: 'denied', policy: 'network-access' });
    await expect(runtime.execute(
      'web_fetch',
      { url: 'https://evil.example/data' },
      'call-network-domain',
    )).resolves.toMatchObject({ status: 'denied', policy: 'network-access' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('denies Bash network commands without a verifiable absolute URL', async () => {
    const execute = vi.fn(async () => 'remote response');
    const { turn } = fixture({
      network: { enabled: true, httpsOnly: true, allowedDomains: ['example.com'] },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'bash')]);

    await expect(runtime.execute('bash', { command: 'curl example.com' }, 'call-network-bare')).resolves.toMatchObject({
      status: 'denied',
      policy: 'network-access',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes the turn signal and waits for real settlement before cancelling', async () => {
    const controller = new AbortController();
    let release!: () => void;
    let markEntered!: () => void;
    const settled = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const execute = vi.fn(async (_input, invocation) => {
      expect(invocation.signal).toBe(controller.signal);
      markEntered();
      await settled;
      return 'late side effect result';
    });
    const { turn, events } = fixture({ signal: controller.signal });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never')]);
    let completed = false;
    const pending = runtime.execute('danger', {}, 'call-2').then((value) => {
      completed = true;
      return value;
    });

    await entered;
    controller.abort('cancelled by caller');
    await Promise.resolve();
    expect(completed).toBe(false);
    release();

    await expect(pending).resolves.toEqual({
      status: 'cancelled',
      reason: 'cancelled by caller',
    });
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_cancelled']);
  });

  it('cancels an in-flight approval and never starts the tool', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => 'unreachable');
    let markApprovalStarted!: () => void;
    const approvalStarted = new Promise<void>((resolve) => { markApprovalStarted = resolve; });
    const { turn, events } = fixture({
      signal: controller.signal,
      approval: {
        requestApproval: ({ signal }) => new Promise<boolean>((resolve) => {
          markApprovalStarted();
          signal.addEventListener('abort', () => resolve(false), { once: true });
        }),
      },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'always')]);
    const pending = runtime.execute('danger', {}, 'call-approval');
    await approvalStarted;
    controller.abort('turn closed');

    await expect(pending).resolves.toEqual({
      status: 'cancelled',
      reason: 'turn closed',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_cancelled']);
  });

  it('treats a tool journal failure as a non-recoverable turn integrity error', async () => {
    const execute = vi.fn(async () => 'must not run');
    const { turn } = fixture({ journalError: new Error('journal offline') });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never')]);

    await expect(runtime.execute('danger', {}, 'call-journal'))
      .rejects.toMatchObject({ name: 'TurnJournalCommitError', message: 'journal offline' });
    expect(execute).not.toHaveBeenCalled();
  });
});

function fixture(options: {
  signal?: AbortSignal;
  approval?: import('../../src/session/session-interaction-port.js').ApprovalPort;
  network?: TurnPolicyContext['network'];
  journalError?: Error;
} = {}) {
  const events: TurnEvent[] = [];
  const turn = createTurnIngress({
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 'http-session' },
    principal: { subjectId: 'user', roles: ['user'] },
    input: { text: 'run' },
    session: { key: 'http:http-session' },
    policy: {
      permissions: ['user'],
      unattended: false,
      ...(options.network ? { network: options.network } : {}),
    },
    capabilities: { tools: ['danger'], skills: [] },
    signal: options.signal ?? new AbortController().signal,
    ports: {
      journal: {
        append: (event) => {
          if (options.journalError) throw options.journalError;
          events.push(event);
        },
      },
      ...(options.approval ? { approval: options.approval } : {}),
    },
  });
  return { turn, events };
}

function tool(
  execute: ToolCapability['execute'],
  approval: ToolCapability['approval'],
  name = 'danger',
): ToolCapability {
  return {
    owner: rootPluginId(),
    name,
    qualifiedName: name,
    description: 'Dangerous tool',
    approval,
    source: '/tools/danger.ts',
    execute,
  };
}
