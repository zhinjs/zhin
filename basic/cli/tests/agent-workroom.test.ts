import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeWorkroomCancelCommand,
  executeWorkroomReadinessCommand,
  executeWorkroomRequestReplanCommand,
  executeWorkroomRunCommand,
  executeWorkroomRunsCommand,
  registerWorkroomOnlineCommands,
} from '../src/commands/agent-workroom.js';

describe('zhin agent workroom runs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists content-free Workroom run headers through the authenticated Host API', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), [
      'http:',
      '  host: 127.0.0.1',
      '  port: 8086',
      '  base: /api',
      '  token: sponsor-token',
      '',
    ].join('\n'));
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8086/api/agent/workroom/runs?projectId=support',
      );
      expect(init?.headers).toEqual({ Authorization: 'Bearer sponsor-token' });
      return new Response(JSON.stringify({
        success: true,
        data: {
          projectId: 'support',
          runs: [{
            version: 1,
            projectId: 'support',
            runId: 'run-2',
            status: 'active',
            sequence: 8,
            cancelRequested: false,
            counts: { tasks: 3, assignments: 2, reviewerAssignments: 1, sponsorGates: 0 },
            authorityDigest: 'sha256:authority',
            digest: 'sha256:run',
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await executeWorkroomRunsCommand({ projectId: 'support' }, projectRoot);

    expect(result).toMatchObject({ projectId: 'support', runs: [{ runId: 'run-2' }] });
    expect(log).toHaveBeenCalledWith([
      'Workroom runs · support',
      'RUN    STATUS  SEQ  TASKS  ASSIGNMENTS  REVIEWERS  GATES  CANCEL',
      'run-2  active  8    3      2            1          0      no',
    ].join('\n'));
    expect(JSON.stringify(result)).not.toMatch(/title|reason|progress|objective/u);
  });

  it('inspects content-free Task and Assignment status for one Run', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), [
      'http:',
      '  port: 8086',
      '  token: sponsor-token',
      '',
    ].join('\n'));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8086/api/agent/workroom/runs/run-2?projectId=support',
      );
      return new Response(JSON.stringify({
        success: true,
        data: {
          version: 1,
          projectId: 'support',
          runId: 'run-2',
          status: 'active',
          sequence: 8,
          cancelRequested: false,
          counts: { tasks: 2, assignments: 1, reviewerAssignments: 0, sponsorGates: 0 },
          authorityDigest: 'sha256:authority',
          digest: 'sha256:run',
          tasks: [{
            version: 1,
            ref: 'task:research:1',
            status: 'executing',
            revision: 1,
            attempt: 1,
            required: true,
            blockerCount: 0,
            hasCurrentAssignment: true,
            digest: 'sha256:task',
          }],
          assignments: [{
            version: 1,
            ref: 'assignment:a-1',
            taskRef: 'task:research:1',
            status: 'running',
            role: 'executor',
            revision: 1,
            attempt: 1,
            fence: 3,
            digest: 'sha256:assignment',
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await executeWorkroomRunCommand({
      projectId: 'support',
      runId: 'run-2',
    }, projectRoot);

    expect(result).toMatchObject({
      projectId: 'support',
      runId: 'run-2',
      tasks: [{ ref: 'task:research:1', status: 'executing' }],
      assignments: [{ ref: 'assignment:a-1', status: 'running' }],
    });
    expect(log).toHaveBeenCalledWith([
      'Workroom run · support/run-2 · active · seq 8',
      '',
      'Tasks',
      'TASK             STATUS     REV  ATTEMPT  REQUIRED  BLOCKERS  ASSIGNED',
      'task:research:1  executing  1    1        yes       0         yes',
      '',
      'Assignments',
      'ASSIGNMENT      TASK             STATUS   ROLE      REV  ATTEMPT  FENCE  OUTCOME',
      'assignment:a-1  task:research:1  running  executor  1    1        3      -',
    ].join('\n'));
    expect(JSON.stringify(result)).not.toMatch(/title|reason|progress|objective|owner/u);
  });

  it('diagnoses content-free blockers and actionable readiness for one Run', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  token: sponsor-token\n');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8086/api/agent/workroom/readiness?projectId=support&runId=run-2',
      );
      return new Response(JSON.stringify({
        success: true,
        data: {
          version: 1, projectId: 'support', runId: 'run-2', sequence: 9, state: 'blocked',
          blockers: [{
            version: 1, taskRef: 'task:triage', blockerRef: 'blocker:provider',
            kind: 'capability', deadline: 120,
            allowedActions: ['resolve', 'replan', 'cancel'], digest: 'sha256:blocker',
          }],
          recommendedActions: ['resolve', 'replan', 'cancel'],
          authorityDigest: 'sha256:authority', digest: 'sha256:readiness',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await executeWorkroomReadinessCommand({
      projectId: 'support', runId: 'run-2',
    }, projectRoot);

    expect(result).toMatchObject({ state: 'blocked', blockers: [{ kind: 'capability' }] });
    expect(log).toHaveBeenCalledWith([
      'Workroom readiness · support/run-2 · blocked · seq 9',
      'TASK         BLOCKER           KIND        DEADLINE  ACTIONS',
      'task:triage  blocker:provider  capability  120       resolve,replan,cancel',
      'Recommended: resolve, replan, cancel',
    ].join('\n'));
    expect(JSON.stringify(result)).not.toMatch(/reason|owner|title|progress/u);
  });

  it('submits typed cancel and replan controls without accepting caller identity or free-form reasons', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  token: sponsor-token\n');
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as { action: string; operationId: string };
      return new Response(JSON.stringify({
        success: true,
        data: {
          status: 'committed', action: command.action, operationId: command.operationId,
          receiptRef: `event:${command.operationId}`, receiptDigest: 'sha256:receipt',
          run: {
            projectId: 'support', runId: 'run-2',
            status: command.action === 'cancel' ? 'cancelling' : 'needs_replan', sequence: 10,
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await executeWorkroomCancelCommand({
      projectId: 'support', runId: 'run-2', expectedSequence: 9,
      reasonCode: 'operator_request', controlDeadline: 120, operationId: 'cancel-1',
    }, projectRoot);
    await executeWorkroomRequestReplanCommand({
      projectId: 'support', runId: 'run-2', expectedSequence: 9,
      reasonCode: 'requirements_changed', operationId: 'replan-1',
    }, projectRoot);

    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'http://127.0.0.1:8086/api/agent/workroom/control', expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sponsor-token', 'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: 1, operationId: 'cancel-1', projectId: 'support', runId: 'run-2',
          expectedSequence: 9, action: 'cancel', reasonCode: 'operator_request',
          controlDeadline: 120,
        }),
      }));
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'http://127.0.0.1:8086/api/agent/workroom/control', expect.objectContaining({
        body: JSON.stringify({
          version: 1, operationId: 'replan-1', projectId: 'support', runId: 'run-2',
          expectedSequence: 9, action: 'request_replan', reasonCode: 'requirements_changed',
        }),
      }));
    expect(log).toHaveBeenNthCalledWith(
      1, 'Workroom control · cancel · committed · support/run-2 · cancelling · seq 10',
    );
    expect(log).toHaveBeenNthCalledWith(
      2, 'Workroom control · request_replan · committed · support/run-2 · needs_replan · seq 10',
    );
  });

  it('prints an explicit empty state instead of an ambiguous header-only table', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), [
      'http:',
      '  token: sponsor-token',
      '',
    ].join('\n'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { projectId: 'support', runs: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await executeWorkroomRunsCommand({ projectId: 'support' }, projectRoot);

    expect(log).toHaveBeenCalledWith('Workroom runs · support\n(none)');
  });

  it('surfaces Host authorization failures without printing a success projection', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), [
      'http:',
      '  token: unbound-token',
      '',
    ].join('\n'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      error: '需要绑定 principal 的 full scope 才能读取 Workroom Run',
    }), { status: 403, headers: { 'content-type': 'application/json' } })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(executeWorkroomRunsCommand({ projectId: 'support' }, projectRoot))
      .rejects.toThrow('需要绑定 principal 的 full scope 才能读取 Workroom Run');
    expect(log).not.toHaveBeenCalled();
  });

  it('emits stable JSON for scripts when requested', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), [
      'http:',
      '  token: sponsor-token',
      '',
    ].join('\n'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { projectId: 'support', runs: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await executeWorkroomRunsCommand({ projectId: 'support', json: true }, projectRoot);

    expect(log).toHaveBeenCalledWith(JSON.stringify({ projectId: 'support', runs: [] }, null, 2));
  });

  it('fails before fetch when the configured Host token is missing', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  port: 8086\n');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeWorkroomRunsCommand({ projectId: 'support' }, projectRoot))
      .rejects.toThrow('Host API token 未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unknown Workroom domain states instead of displaying them as authoritative', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  token: sponsor-token\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        projectId: 'support',
        runs: [{
          version: 1,
          projectId: 'support',
          runId: 'run-1',
          status: 'mysterious',
          sequence: 1,
          cancelRequested: false,
          counts: { tasks: 0, assignments: 0, reviewerAssignments: 0, sponsorGates: 0 },
          authorityDigest: 'sha256:authority',
          digest: 'sha256:run',
        }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await expect(executeWorkroomRunsCommand({ projectId: 'support' }, projectRoot))
      .rejects.toThrow('无效的 Workroom Run header');
  });

  it('registers the confirmed command grammar on the synchronous production Commander seam', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  token: sponsor-token\n');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { projectId: 'support', runs: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const previousCwd = process.cwd();
    const command = new Command('agent');
    registerWorkroomOnlineCommands(command);
    try {
      process.chdir(projectRoot);
      command.parse(['node', 'agent', 'workroom', 'runs', '--project', 'support']);
      await vi.waitFor(() => {
        expect(log).toHaveBeenCalledWith('Workroom runs · support\n(none)');
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('maps the synchronous request-replan grammar to one typed Host control command', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  token: sponsor-token\n');
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        success: true,
        data: {
          status: 'committed', action: command.action, operationId: command.operationId,
          receiptRef: 'event-1', receiptDigest: 'sha256:receipt',
          run: { projectId: 'support', runId: 'run-2', status: 'needs_replan', sequence: 10 },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const previousCwd = process.cwd();
    const command = new Command('agent');
    registerWorkroomOnlineCommands(command);
    try {
      process.chdir(projectRoot);
      command.parse([
        'node', 'agent', 'workroom', 'request-replan', 'run-2',
        '--project', 'support', '--expected-sequence', '9',
        '--reason-code', 'requirements_changed', '--operation-id', 'replan-1',
      ]);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
        version: 1, operationId: 'replan-1', projectId: 'support', runId: 'run-2',
        expectedSequence: 9, action: 'request_replan', reasonCode: 'requirements_changed',
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('turns an async Workroom action failure into a controlled CLI error', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'zhin-workroom-cli-'));
    await writeFile(join(projectRoot, 'zhin.config.yml'), 'http:\n  token: "   "\n');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const previousCwd = process.cwd();
    const previousExitCode = process.exitCode;
    const command = new Command('agent');
    registerWorkroomOnlineCommands(command);
    try {
      process.chdir(projectRoot);
      process.exitCode = undefined;
      command.parse(['node', 'agent', 'workroom', 'runs', '--project', 'support']);
      await vi.waitFor(() => {
        expect(error).toHaveBeenCalledWith(
          'Host API token 未配置；请配置绑定 principal 的 full scope token',
        );
        expect(process.exitCode).toBe(1);
      });
    } finally {
      process.chdir(previousCwd);
      process.exitCode = previousExitCode;
    }
  });
});
