import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { TurnEvent } from '../../src/event/turn-event.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress, type TurnPolicyContext } from '../../src/turn/turn-ingress.js';
import * as policyFacade from '../../src/security/policy-facade.js';
import { NetworkAccessDeniedError } from '../../src/security/network-policy.js';
import { OutboundLeakInspector } from '../../src/security/outbound-leak-guard.js';

describe('TurnToolRuntime', () => {
  it.each([false, true])('binds human approval to an isolated nested argument snapshot (provenance: %s)', async (tainted) => {
    const execute = vi.fn<ToolCapability['execute']>(async () => 'done');
    const args = { group_id: 129043431, user_id: 123456789, reason: '明确广告', evidence: [{ message: { id: 'original' } }] };
    const original = structuredClone(args);
    const requestApproval = vi.fn<import('../../src/session/approval-port.js').ApprovalPort['requestApproval']>()
      .mockImplementation(async () => {
        args.group_id = 987654321;
        args.user_id = 234567890;
        args.evidence[0]!.message.id = 'different';
        return true;
      });
    const { turn } = fixture({ approval: { requestApproval } });
    const runtime = new TurnToolRuntime(turn, [{ ...tool(execute, 'human', 'group_kick'), ...(tainted ? { tags: ['outbound'] } : {}) }]);
    if (tainted) runtime.provenance.record({ kind: 'conversation_context' });

    await expect(runtime.execute('group_kick', args, 'snapshot')).resolves.toMatchObject({ status: 'completed' });

    const request = requestApproval.mock.calls[0]![0];
    expect(request.question).toContain('"group_id":129043431');
    expect(request.question).toContain('"user_id":123456789');
    expect(request.question).toContain('"id":"original"');
    if (!tainted) expect(request.scopeKey).toContain('"user_id":123456789');
    expect(execute).toHaveBeenCalledExactlyOnceWith(original, expect.anything());
    expect(execute.mock.calls[0]![0]).not.toBe(args);
  });

  it.each(['function', 'cycle'])('denies human confirmation when arguments cannot be safely snapshotted: %s', async (invalid) => {
    const execute = vi.fn(async () => 'done');
    const requestApproval = vi.fn(async () => true);
    const { turn, events } = fixture({ approval: { requestApproval } });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'human')]);
    const args: Record<string, unknown> = { user_id: 123456789 };
    args.unsupported = invalid === 'function' ? () => 'not JSON' : args;

    await expect(runtime.execute('danger', args, 'invalid-snapshot')).resolves.toMatchObject({
      status: 'denied', policy: 'approval',
    });

    expect(requestApproval).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(events.map(event => event.type)).toEqual(['tool_call', 'tool_denied']);
  });

  it('shows the final masked arguments before human approval and executes that same snapshot', async () => {
    const execute = vi.fn(async () => 'done');
    const requestApproval = vi.fn<import('../../src/session/approval-port.js').ApprovalPort['requestApproval']>()
      .mockResolvedValue(true);
    const { turn } = fixture({ approval: { requestApproval } });
    const inspector = new OutboundLeakInspector({ secretValues: ['fixture-secret-123456'] });
    const runtime = new TurnToolRuntime(turn, [{ ...tool(execute, 'human'), tags: ['outbound'] }], { leakInspector: inspector });

    await runtime.execute('danger', { target: 'reviewed-group', text: 'fixture-secret-123456' }, 'masked');

    const request = requestApproval.mock.calls[0]![0];
    expect(request.question).toContain('"text":"[已隐藏：密钥]"');
    expect(request.question).not.toContain('fixture-secret-123456');
    expect(request.scopeKey).toContain('"text":"[已隐藏：密钥]"');
    expect(execute).toHaveBeenCalledExactlyOnceWith({ target: 'reviewed-group', text: '[已隐藏：密钥]' }, expect.anything());
  });

  it('shows each human-only kick target and reason before approving that invocation', async () => {
    const execute = vi.fn(async () => 'done');
    const requestApproval = vi.fn<import('../../src/session/approval-port.js').ApprovalPort['requestApproval']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { turn } = fixture({ approval: { requestApproval } });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'human', 'group_kick')]);
    const approved = { group_id: 129043431, user_id: 123456789, reason: '明确广告' };
    const denied = { group_id: 987654321, user_id: 234567890, reason: '持续辱骂' };

    await expect(runtime.execute('group_kick', approved, 'kick-1')).resolves.toMatchObject({ status: 'completed' });
    await expect(runtime.execute('group_kick', denied, 'kick-2')).resolves.toMatchObject({ status: 'denied' });

    expect(requestApproval).toHaveBeenCalledTimes(2);
    for (const [index, args] of [approved, denied].entries()) {
      expect(requestApproval.mock.calls[index]![0]).toMatchObject({
        humanOnly: true,
        requestId: `turn:kick-${index + 1}`,
        question: expect.stringContaining(`本次参数：{"group_id":${args.group_id},"reason":"${args.reason}","user_id":${args.user_id}}`),
      });
    }
    expect(execute).toHaveBeenCalledExactlyOnceWith(approved, expect.anything());
  });

  it('keeps existing non-human approval prompts unchanged', async () => {
    const requestApproval = vi.fn<import('../../src/session/approval-port.js').ApprovalPort['requestApproval']>()
      .mockResolvedValue(false);
    const { turn } = fixture({ approval: { requestApproval } });
    const runtime = new TurnToolRuntime(turn, [tool(async () => 'done', 'always')]);

    await runtime.execute('danger', { arbitrary: 'value' }, 'ordinary');

    expect(requestApproval.mock.calls[0]![0].question).toBe(
      '工具「danger」需要确认后执行。\n风险：tool approval policy is always\n是否继续？',
    );
  });

  it('keeps concrete human-only confirmation when provenance also requires approval', async () => {
    const execute = vi.fn(async () => 'done');
    const requestApproval = vi.fn<import('../../src/session/approval-port.js').ApprovalPort['requestApproval']>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { turn } = fixture({ approval: { requestApproval } });
    const runtime = new TurnToolRuntime(turn, [{ ...tool(execute, 'human', 'group_kick'), tags: ['outbound'] }]);
    runtime.provenance.record({ kind: 'conversation_context' });
    const args = { group_id: 129043431, user_id: 123456789, reason: '明确广告' };

    await expect(runtime.execute('group_kick', args, 'tainted-1')).resolves.toMatchObject({ status: 'completed' });
    await expect(runtime.execute('group_kick', args, 'tainted-2')).resolves.toMatchObject({
      status: 'denied', policy: 'external-content-confirmation',
    });

    expect(requestApproval).toHaveBeenCalledTimes(2);
    for (const [index, [request]] of requestApproval.mock.calls.entries()) {
      expect(request).toMatchObject({
        humanOnly: true,
        requestId: `turn:tainted-${index + 1}`,
        scopeKey: `external-content-confirmation:turn:tainted-${index + 1}`,
        question: expect.stringContaining('本次参数：{"group_id":129043431,"reason":"明确广告","user_id":123456789}'),
      });
      expect(request.remember).toBeUndefined();
    }
    expect(execute).toHaveBeenCalledExactlyOnceWith(args, expect.anything());
  });

  it('preserves fresh human authority on each invocation', async () => {
    const execute = vi.fn(async () => 'done');
    const requestApproval = vi.fn(async () => true);
    const { turn } = fixture({ approval: { requestApproval } });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'human')]);
    await runtime.execute('danger', {}, 'human-1');
    await runtime.execute('danger', {}, 'human-2');
    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ humanOnly: true }));
    expect(requestApproval.mock.calls.every(([request]) => request.remember === undefined)).toBe(true);
  });
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

  it('does not start a tool cancelled while asynchronous policy checks are pending', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => 'side effect');
    const { turn, events } = fixture({ signal: controller.signal });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = policyFacade.runTurnToolPolicies;
    const check = vi.spyOn(policyFacade, 'runTurnToolPolicies').mockImplementation(async input => {
      entered();
      await gate;
      return original(input);
    });
    try {
      const runtime = new TurnToolRuntime(turn, [tool(execute, 'never')]);
      const pending = runtime.execute('danger', {}, 'during-policy');
      await started;
      controller.abort('cancelled during authorization');
      release();
      await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
      expect(execute).not.toHaveBeenCalled();
      expect(events.map(event => event.type)).toEqual(['tool_call', 'tool_cancelled']);
    } finally { release(); check.mockRestore(); }
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

  it('lets canonical on-risk reads execute after their dedicated policy passes', async () => {
    const execute = vi.fn(async () => 'contents');
    const { turn } = fixture({ roles: ['master'], workspaceRoot: process.cwd() });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'on-risk', 'read_file')]);

    await expect(runtime.execute('read_file', { file_path: 'README.md' }, 'safe-read'))
      .resolves.toMatchObject({ status: 'completed', output: 'contents' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown on-risk plugin tools behind approval', async () => {
    const execute = vi.fn(async () => 'unsafe');
    const { turn } = fixture();
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'on-risk', 'plugin_action')]);

    await expect(runtime.execute('plugin_action', {}, 'unknown-risk')).resolves.toMatchObject({
      status: 'denied', policy: 'approval',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('marks once approvals as session grants scoped to the Tool', async () => {
    const execute = vi.fn(async () => 'done');
    const requestApproval = vi.fn(async () => true);
    const { turn } = fixture({ approval: { available: true, requestApproval } });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'once', 'plugin_action')]);

    await runtime.execute('plugin_action', { value: 1 }, 'once-approval');
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'plugin_action',
      scopeKey: 'plugin_action',
      remember: 'session',
    }));
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
    const { turn, events } = fixture({ workspaceRoot: process.cwd() });
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
    const { turn, events } = fixture({ workspaceRoot: process.cwd() });
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
    const { turn } = fixture({ shell: { preset: 'readonly' }, workspaceRoot: process.cwd() });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'bash')]);

    await expect(runtime.execute('bash', { command: 'git status' }, 'call-shell-preset'))
      .resolves.toMatchObject({ status: 'denied', policy: 'exec-policy' });
    await expect(runtime.execute('bash', { command: 'pwd' }, 'call-shell-readonly'))
      .resolves.toMatchObject({ status: 'completed', output: 'ran' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('denies file and shell writes for an owner in a read-only workspace', async () => {
    const executeFile = vi.fn(async () => 'wrote');
    const executeBash = vi.fn(async () => 'wrote');
    const { turn } = fixture({
      roles: ['master'],
      filesystem: { workspaceRoot: process.cwd(), workingDirectory: process.cwd(), access: 'read-only' },
    });
    const runtime = new TurnToolRuntime(turn, [
      tool(executeFile, 'never', 'write_file'),
      tool(executeBash, 'never', 'bash'),
    ]);

    await expect(runtime.execute('write_file', { file_path: 'output.txt', content: 'x' }, 'file-ro'))
      .resolves.toMatchObject({ status: 'denied', policy: 'workspace-access' });
    await expect(runtime.execute('bash', { command: 'touch output.txt' }, 'bash-ro'))
      .resolves.toMatchObject({ status: 'denied', policy: 'workspace-access' });
    expect(executeFile).not.toHaveBeenCalled();
    expect(executeBash).not.toHaveBeenCalled();
  });

  it('injects the configured working directory into Bash execution', async () => {
    const execute = vi.fn(async () => 'pwd');
    const { turn } = fixture({
      roles: ['master'],
      filesystem: { workspaceRoot: process.cwd(), workingDirectory: join(process.cwd(), 'packages'), access: 'workspace-write' },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'bash')]);

    await expect(runtime.execute('bash', { command: 'pwd' }, 'bash-cwd'))
      .resolves.toMatchObject({ status: 'completed' });
    expect(execute).toHaveBeenCalledWith(
      { command: 'pwd', cwd: join(process.cwd(), 'packages') },
      expect.any(Object),
    );
  });

  it('passes the fail-closed isolation contract through the typed execution context', async () => {
    const execute = vi.fn(async () => 'ok');
    const workspace = join(process.cwd(), 'packages');
    const { turn } = fixture({
      roles: ['master'],
      filesystem: { workspaceRoot: workspace, workingDirectory: workspace, access: 'workspace-write' },
      shell: {
        security: 'allowlist',
        execPreset: 'development',
        approvalMode: 'auto',
        isolation: 'required',
      },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'bash')]);

    await expect(runtime.execute('bash', { command: 'node -e "console.log(1)"' }, 'isolated'))
      .resolves.toMatchObject({ status: 'completed' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }), expect.any(Object));
    const authorizedInput = execute.mock.calls[0]?.[0];
    const executionContext = execute.mock.calls[0]?.[1];
    expect(executionContext?.policy).toMatchObject({
      filesystem: {
        workingDirectory: workspace,
        access: 'workspace-write',
      },
      network: { enabled: false },
      shell: { isolation: 'required' },
    });
    expect(authorizedInput).toEqual({ command: 'node -e "console.log(1)"', cwd: workspace });
  });

  it('routes per-turn shell ask decisions through ApprovalPort', async () => {
    const execute = vi.fn(async () => 'ok');
    const requestApproval = vi.fn(async () => true);
    const { turn } = fixture({
      roles: ['master'],
      approval: { available: true, requestApproval },
      filesystem: { workspaceRoot: process.cwd(), workingDirectory: process.cwd(), access: 'workspace-write' },
      shell: {
        security: 'allowlist',
        execPreset: 'development',
        approvalMode: 'ask',
        isolation: 'required',
      },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'bash')]);

    await expect(runtime.execute('bash', { command: 'cargo test' }, 'approval'))
      .resolves.toMatchObject({ status: 'completed' });
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'bash',
      scopeKey: expect.stringContaining('cargo test'),
      question: expect.stringContaining('cargo'),
    }));
    expect(requestApproval.mock.calls[0]?.[0].scopeKey).toContain(process.cwd());
    expect(requestApproval.mock.calls[0]?.[0].question).toContain(`工作目录：${process.cwd()}`);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('lets the owner read protected project files in the workspace without approval', async () => {
    const execute = vi.fn(async () => '{}');
    const requestApproval = vi.fn(async () => false);
    const { turn } = fixture({
      roles: ['master'],
      workspaceRoot: process.cwd(),
      approval: { available: true, requestApproval },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'read_file')]);

    await expect(runtime.execute('read_file', { file_path: 'package.json' }, 'owner-read'))
      .resolves.toMatchObject({ status: 'completed' });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('still asks the owner before writing a protected project file', async () => {
    const execute = vi.fn(async () => 'written');
    const requestApproval = vi.fn(async () => false);
    const { turn } = fixture({
      roles: ['master'],
      workspaceRoot: process.cwd(),
      approval: { available: true, requestApproval },
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'never', 'write_file')]);

    await expect(runtime.execute('write_file', { file_path: 'package.json', content: '{}' }, 'owner-write'))
      .resolves.toMatchObject({ status: 'denied', policy: 'file-permission-matrix' });
    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'denied', by: 'user' } as const, /denied by the user/],
    [{ status: 'denied', by: 'reviewer' } as const, /automatic approval reviewer \(no human was asked\)/],
    [{ status: 'denied', by: 'remembered' } as const, /already rejected/],
    [{ status: 'timed_out' } as const, /timed out without an answer/],
    [{ status: 'unavailable', reason: 'prompt undeliverable' } as const, /no approval channel is available \(prompt undeliverable\)/],
  ])('reports approval outcome %o to the model without inviting a retry', async (outcome, reason) => {
    const execute = vi.fn(async () => 'done');
    const { turn } = fixture({
      approval: {
        available: true,
        requestApproval: async () => false,
        requestApprovalOutcome: async () => outcome,
      } as import('../../src/session/approval-port.js').ApprovalOutcomePort,
    });
    const runtime = new TurnToolRuntime(turn, [tool(execute, 'once', 'plugin_action')]);

    const result = await runtime.execute('plugin_action', {}, 'outcome');
    expect(result).toMatchObject({ status: 'denied', reason: expect.stringMatching(reason) });
    expect(result).toMatchObject({ reason: expect.stringMatching(/Do not retry/) });
    expect(execute).not.toHaveBeenCalled();
  });

  it('records real settlement but returns cancellation when a tool ignores the signal', async () => {
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
    expect(events.map((event) => event.type)).toEqual(['tool_call', 'tool_result']);
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
  filesystem?: TurnPolicyContext['filesystem'];
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
      ...(options.filesystem
        ? { filesystem: options.filesystem }
        : options.workspaceRoot ? { filesystem: { workspaceRoot: options.workspaceRoot } } : {}),
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
  requiresApproval: ToolCapability['requiresApproval'],
  name = 'danger',
): ToolCapability {
  return {
    owner: rootPluginId(),
    name,
    qualifiedName: name,
    description: 'Dangerous tool',
    requiresApproval,
    source: '/tools/danger.ts',
    execute,
  };
}
