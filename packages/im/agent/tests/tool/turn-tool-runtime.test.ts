import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { TurnEvent } from '../../src/event/turn-event.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import { NetworkAccessDeniedError } from '../../src/security/network-policy.js';

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
    const { turn, events } = fixture({ workspaceRoot: process.cwd() });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'write_file')]);

    await expect(runtime.execute('write_file', { file_path: 'output.txt' }, 'call-file')).resolves.toMatchObject({
      status: 'denied',
      policy: 'file-permission-matrix',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('denies canonical sensitive file reads for a regular user', async () => {
    const execute = vi.fn(async () => 'sensitive contents');
    const { turn, events } = fixture({ workspaceRoot: process.cwd() });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'read_file')]);

    await expect(runtime.execute('read_file', { file_path: '.env' }, 'call-read')).resolves.toMatchObject({
      status: 'denied',
      policy: 'workspace-access',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('keeps runtime-private .zhin state outside every file Tool capability', async () => {
    const execute = vi.fn(async () => 'private state');
    const { turn } = fixture({ roles: ['master'], workspaceRoot: process.cwd() });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'read_file')]);

    await expect(runtime.execute('read_file', {
      file_path: '.zhin/todos/secret.json',
    }, 'call-runtime-private')).resolves.toMatchObject({
      status: 'denied', policy: 'workspace-access',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when a file tool has no workspace authority', async () => {
    const execute = vi.fn(async () => 'contents');
    const { turn } = fixture({ roles: ['master'] });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'read_file')]);

    await expect(runtime.execute('read_file', { file_path: 'README.md' }, 'call-no-workspace'))
      .resolves.toMatchObject({ status: 'denied', policy: 'workspace-access' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('normalizes file targets inside the authorized workspace before execution', async () => {
    const execute = vi.fn(async () => 'contents');
    const { turn } = fixture({ roles: ['master'], workspaceRoot: process.cwd() });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'read_file')]);

    await expect(runtime.execute('read_file', { file_path: 'README.md' }, 'call-workspace'))
      .resolves.toMatchObject({ status: 'completed' });
    expect(execute).toHaveBeenCalledWith(
      { file_path: `${process.cwd()}/README.md` },
      expect.objectContaining({ policy: expect.objectContaining({ filesystem: { workspaceRoot: process.cwd() } }) }),
    );
  });

  it('denies absolute paths outside the authorized workspace even for master', async () => {
    const execute = vi.fn(async () => 'contents');
    const { turn } = fixture({ roles: ['master'], workspaceRoot: process.cwd() });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'read_file')]);

    await expect(runtime.execute('read_file', { file_path: '/etc/hosts' }, 'call-outside'))
      .resolves.toMatchObject({ status: 'denied', policy: 'workspace-access' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('denies a missing write target reached through a workspace symlink', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zhin-workspace-'));
    const outside = await mkdtemp(join(tmpdir(), 'zhin-outside-'));
    try {
      await symlink(join(outside, 'missing.txt'), join(workspace, 'escape.txt'));
      const execute = vi.fn(async () => 'unsafe write');
      const { turn } = fixture({ roles: ['master'], workspaceRoot: workspace });
      const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'write_file')]);

      await expect(runtime.execute('write_file', {
        file_path: 'escape.txt', content: 'secret',
      }, 'call-symlink')).resolves.toMatchObject({ status: 'denied', policy: 'workspace-access' });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
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

  it('records a transport-level network policy rejection as denied', async () => {
    const execute = vi.fn(async () => { throw new NetworkAccessDeniedError('redirect denied'); });
    const { turn, events } = fixture({
      network: { enabled: true, httpsOnly: true, allowedDomains: ['allowed.example'] },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'web_fetch')]);

    await expect(runtime.execute('web_fetch', {
      url: 'https://allowed.example/start',
    }, 'call-redirect')).resolves.toMatchObject({
      status: 'denied', policy: 'network-access', reason: 'redirect denied',
    });
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_denied']);
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

  it('enforces the unattended Shell preset before executing Bash', async () => {
    const execute = vi.fn(async () => 'ran');
    const { turn } = fixture({ shell: { preset: 'readonly' } });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'bash')]);

    await expect(runtime.execute('bash', { command: 'git status' }, 'call-shell-preset'))
      .resolves.toMatchObject({ status: 'denied', policy: 'exec-policy' });
    await expect(runtime.execute('bash', { command: 'pwd' }, 'call-shell-readonly'))
      .resolves.toMatchObject({ status: 'completed', output: 'ran' });
    expect(execute).toHaveBeenCalledTimes(1);
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

  it('records the participant whose control message caused a tool call', async () => {
    const execute = vi.fn(async () => 'ok');
    const { turn, events } = fixture();
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never')]);

    await runtime.execute('danger', {}, 'call-bob', {
      principal: { subjectId: 'bob-id', displayName: 'Bob', roles: ['trusted'], scope: 'group' },
      turn: { turnId: 'turn-bob', intent: 'steer', targetTurnId: 'turn-alice' },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        causedBy: expect.objectContaining({
          principal: expect.objectContaining({ subjectId: 'bob-id', displayName: 'Bob' }),
          turn: { turnId: 'turn-bob', intent: 'steer', targetTurnId: 'turn-alice' },
        }),
      }),
      expect.objectContaining({
        type: 'tool_result',
        causedBy: expect.objectContaining({
          principal: expect.objectContaining({ subjectId: 'bob-id', displayName: 'Bob' }),
          turn: { turnId: 'turn-bob', intent: 'steer', targetTurnId: 'turn-alice' },
        }),
      }),
    ]);
  });
});

function fixture(options: {
  signal?: AbortSignal;
  approval?: import('../../src/session/approval-port.js').ApprovalPort;
  network?: TurnPolicyContext['network'];
  shell?: TurnPolicyContext['shell'];
  journalError?: Error;
  roles?: readonly string[];
  workspaceRoot?: string;
} = {}) {
  const events: TurnEvent[] = [];
  const turn = createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 'http-session' },
    principal: { subjectId: 'user', roles: options.roles ?? ['user'] },
    input: { text: 'run' },
    session: { key: 'http:http-session' },
    policy: {
      permissions: ['user'],
      unattended: false,
      ...(options.network ? { network: options.network } : {}),
      ...(options.shell ? { shell: options.shell } : {}),
      ...(options.workspaceRoot ? { filesystem: { workspaceRoot: options.workspaceRoot } } : {}),
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
