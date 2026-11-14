/**
 * #1250 security review: an admin initiator approves only what the policy explicitly marks admin-approvable.
 * Owner-only decisions (sensitive files, shell, shared memory) and undeclared plugin-tool approvals reach the
 * IM self-approval port marked accordingly, and the port refuses them without prompting.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { createRuntimeApprovalPort } from '../../src/plugin-runtime/ingress/request-ports.js';
import { ADMIN_APPROVABLE_TOOL_TAG } from '../../src/security/admin-approvable.js';
import { registerSensitiveExecCommand } from '../../src/security/sensitive-exec-commands.js';
import { createScheduleTools } from '../../src/schedule-manager.js';
import { isApprovalPortAvailable, type ApprovalOutcomePort, type ApprovalRequestInput } from '../../src/session/approval-port.js';

let workspace: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'zhin-admin-approval-'));
  await mkdir(join(workspace, '.git'), { recursive: true });
  await writeFile(join(workspace, '.git', 'config'), '[remote "origin"]\n\turl = https://user:hunter2@example.com/repo.git\n');
  await writeFile(join(workspace, 'notes.txt'), 'hello');
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** An IM self-approval port (admin initiator in their private chat) whose prompts are always answered "allow once". */
function selfApprovalPort() {
  const asked: unknown[] = [];
  const requests: ApprovalRequestInput[] = [];
  const interaction = {
    ask: vi.fn(async (request: unknown) => { asked.push(request); return 'approve-once' as never; }),
    sequence: async () => ({}) as never,
  };
  const inner = createRuntimeApprovalPort({ isMaster: false, interaction, selfApproval: true });
  const port: ApprovalOutcomePort = {
    available: inner.available,
    requestApproval: inner.requestApproval,
    requestApprovalOutcome: async (input) => { requests.push(input); return inner.requestApprovalOutcome(input); },
  };
  return { port, asked, requests };
}

function adminTurn(approval: ApprovalOutcomePort, options: { shell?: boolean } = {}) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'alice' },
    // An endpoint-level admin: host trust `admin, trusted` (ADR 0056).
    principal: { subjectId: 'alice', roles: ['admin', 'trusted'] },
    input: { text: '看看 .git/config' },
    session: { key: 'qq:bot:private:alice' },
    policy: {
      permissions: ['admin', 'trusted'],
      unattended: false,
      filesystem: { workspaceRoot: workspace, workingDirectory: workspace, access: 'workspace-write' },
      ...(options.shell ? { shell: { security: 'allowlist' as const, execPreset: 'development' as const, approvalMode: 'ask' as const } } : {}),
    },
    capabilities: { tools: ['read_file', 'bash', 'plugin_op', 'tagged_op', 'never_op'], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined }, approval },
  });
}

function tool(
  name: string,
  requiresApproval: ToolCapability['requiresApproval'],
  execute: ToolCapability['execute'] = vi.fn(async () => 'ok'),
  extra: Partial<ToolCapability> = {},
): ToolCapability {
  return { owner: rootPluginId(), name, qualifiedName: name, description: name, requiresApproval, source: `/tools/${name}.ts`, execute, ...extra };
}

describe('admin initiator self-approval (#1250 review S1)', () => {
  it('refuses a sensitive file read that needs the owner, without prompting the admin', async () => {
    const { port, asked, requests } = selfApprovalPort();
    const execute = vi.fn(async () => 'secret');
    const outcome = await new TurnToolRuntime(adminTurn(port), [tool('read_file', 'on-risk', execute)])
      .execute('read_file', { file_path: '.git/config' }, 'r1');
    expect(outcome).toMatchObject({ status: 'denied', policy: 'file-permission-matrix' });
    expect((outcome as { reason: string }).reason).toContain('bot owner');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ purpose: 'authorization', requiresOwner: true });
    expect(requests[0]!.adminMayApprove).toBeUndefined();
    expect(asked).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a plugin tool approval that is not declared admin-approvable', async () => {
    for (const mode of ['always', 'once', 'on-risk'] as const) {
      const { port, asked, requests } = selfApprovalPort();
      const execute = vi.fn(async () => 'done');
      const outcome = await new TurnToolRuntime(adminTurn(port), [tool('plugin_op', mode, execute)]).execute('plugin_op', {}, `p-${mode}`);
      expect(outcome).toMatchObject({ status: 'denied', policy: 'approval' });
      expect(requests[0]!.adminMayApprove).toBeUndefined();
      expect(asked).toHaveLength(0);
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it('lets the admin approve a tool declared admin-approvable once', async () => {
    const { port, asked, requests } = selfApprovalPort();
    const execute = vi.fn(async () => 'done');
    const outcome = await new TurnToolRuntime(adminTurn(port), [tool('tagged_op', 'always', execute, { tags: [ADMIN_APPROVABLE_TOOL_TAG] })])
      .execute('tagged_op', {}, 't1');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(requests[0]).toMatchObject({ purpose: 'authorization', adminMayApprove: true });
    expect(asked).toHaveLength(1);
  });

  it('never treats a human-only tool as admin-approvable, even with the tag', async () => {
    const { port, asked } = selfApprovalPort();
    const execute = vi.fn(async () => 'done');
    const outcome = await new TurnToolRuntime(adminTurn(port), [tool('tagged_op', 'human', execute, { tags: [ADMIN_APPROVABLE_TOOL_TAG] })])
      .execute('tagged_op', {}, 'h1');
    expect(outcome.status).toBe('denied');
    expect(asked).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('declares the Host schedule_add tool admin-approvable (the case the admin path was built for)', () => {
    const tools = createScheduleTools({} as never);
    expect(tools.find(entry => entry.name === 'schedule_add')!.definition.tags).toContain(ADMIN_APPROVABLE_TOOL_TAG);
    for (const entry of tools.filter(item => item.name !== 'schedule_add')) {
      expect(entry.definition.tags ?? []).not.toContain(ADMIN_APPROVABLE_TOOL_TAG);
    }
  });

  it('marks a shell approval as owner-only', async () => {
    const unregister = registerSensitiveExecCommand({ command: 'deploycli', sensitive: [/^deploycli\s+push\b/u] });
    try {
      const { port, asked, requests } = selfApprovalPort();
      const execute = vi.fn(async () => 'pushed');
      const outcome = await new TurnToolRuntime(adminTurn(port, { shell: true }), [tool('bash', 'on-risk', execute)])
        .execute('bash', { command: 'deploycli push --token=sk-live-abcdefghijklmnop' }, 'b1');
      expect(outcome).toMatchObject({ status: 'denied', policy: 'exec-policy' });
      expect(requests[0]).toMatchObject({ requiresOwner: true });
      expect(asked).toHaveLength(0);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  describe('after external content (provenance gate)', () => {
    it('one admin answer covers a declared admin-approvable tool', async () => {
      const { port, asked, requests } = selfApprovalPort();
      const execute = vi.fn(async () => 'scheduled');
      const runtime = new TurnToolRuntime(adminTurn(port),
        [tool('schedule_add', 'on-risk', execute, { tags: [ADMIN_APPROVABLE_TOOL_TAG] })]);
      runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
      await expect(runtime.execute('schedule_add', { cron: '0 9 * * 1-5' }, 'v1')).resolves.toMatchObject({ status: 'completed' });
      expect(requests.map(request => request.purpose)).toEqual(['intent']);
      expect(asked).toHaveLength(1);
    });

    it('does not let an admin intent answer stand in for an owner-only authorization', async () => {
      const { port, asked, requests } = selfApprovalPort();
      const execute = vi.fn(async () => 'scheduled');
      const runtime = new TurnToolRuntime(adminTurn(port), [tool('schedule_add', 'always', execute)]);
      runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
      const outcome = await runtime.execute('schedule_add', {}, 'v2');
      expect(outcome).toMatchObject({ status: 'denied' });
      expect(requests[0]).toMatchObject({ purpose: 'intent', requiresOwner: true });
      expect(asked).toHaveLength(0);
      expect(execute).not.toHaveBeenCalled();
    });

    it('still lets the admin confirm intent for a call that needs no authorization', async () => {
      const { port, asked } = selfApprovalPort();
      const execute = vi.fn(async () => 'scheduled');
      const runtime = new TurnToolRuntime(adminTurn(port), [tool('schedule_add', 'never', execute)]);
      runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
      await expect(runtime.execute('schedule_add', {}, 'v3')).resolves.toMatchObject({ status: 'completed' });
      expect(asked).toHaveLength(1);
    });
  });
});

describe('approval port availability per purpose (#1250 review M3)', () => {
  function intentOnlyPort() {
    const asked: unknown[] = [];
    const requests: ApprovalRequestInput[] = [];
    const intentInteraction = {
      ask: vi.fn(async (request: unknown) => { asked.push(request); return 'approve-once' as never; }),
      sequence: async () => ({}) as never,
    };
    const inner = createRuntimeApprovalPort({ isMaster: false, intentInteraction, unavailableReason: 'no bot owner is configured' });
    const port: ApprovalOutcomePort = {
      available: inner.available,
      ...(inner.intentAvailable !== undefined ? { intentAvailable: inner.intentAvailable } : {}),
      requestApproval: inner.requestApproval,
      requestApprovalOutcome: async (input) => { requests.push(input); return inner.requestApprovalOutcome(input); },
    };
    return { port, asked, requests };
  }

  it('reports an intent-only port unavailable to authorization callers and available for intent', () => {
    const { port } = intentOnlyPort();
    expect(isApprovalPortAvailable(port)).toBe(false);
    expect(isApprovalPortAvailable(port, 'authorization')).toBe(false);
    expect(isApprovalPortAvailable(port, 'intent')).toBe(true);
  });

  it('lets an ordinary approval fail fast without entering the port, while intent still works', async () => {
    const { port, requests, asked } = intentOnlyPort();
    const execute = vi.fn(async () => 'done');
    const outcome = await new TurnToolRuntime(adminTurn(port), [tool('plugin_op', 'always', execute)]).execute('plugin_op', {}, 'm1');
    expect(outcome).toMatchObject({ status: 'denied' });
    expect((outcome as { reason: string }).reason).toContain('no approval channel');
    expect(requests).toHaveLength(0);

    const runtime = new TurnToolRuntime(adminTurn(port), [tool('schedule_add', 'never', execute)]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('schedule_add', {}, 'm2')).resolves.toMatchObject({ status: 'completed' });
    expect(requests.map(request => request.purpose)).toEqual(['intent']);
    expect(asked).toHaveLength(1);
  });
});
