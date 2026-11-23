/**
 * #1250 `schedule-list-classified-high-risk`: a config / schedule tool that only reads is not a
 * high-risk write. A `readOnly` declaration (from the tool's code) or a `<noun>_<read verb>` name lifts
 * a name-only category; any stricter marker on the same tool keeps it.
 */
import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { classifyHighRiskAction, classifyToolOutput, resolveInjectionGuard } from '../../src/security/provenance.js';
import { readOnlyDeclarationApplies } from '../../src/security/policy-facade.js';
import { createScheduleTools } from '../../src/schedule-manager.js';
import type { ApprovalOutcomePort } from '../../src/session/approval-port.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';

describe('classifyHighRiskAction: reads are not high-risk writes (#1250)', () => {
  it.each(['schedule_list', 'remind_list', 'reminder_get', 'cron_show', 'timer_status', 'config_get', 'settings_show'])(
    'treats the read-suffixed name %s as a read', (name) => {
      expect(classifyHighRiskAction({ name })).toBeUndefined();
    });

  it('honours a readOnly declaration on a schedule / config name without a write verb', () => {
    expect(classifyHighRiskAction({ name: 'schedule_overview' })).toBe('schedule');
    expect(classifyHighRiskAction({ name: 'schedule_overview', readOnly: true })).toBeUndefined();
    expect(classifyHighRiskAction({ name: 'config_dump', readOnly: true })).toBeUndefined();
  });

  it.each([
    'schedule_add', 'schedule_update', 'schedule_remove', 'schedule_pause', 'schedule_resume', 'set_config',
    'install_plugin', 'create_reminder', 'schedule_add_list', 'remind_cancel_get', 'config_set_status',
  ])('keeps a write-verb name %s in its category, readOnly or read suffix notwithstanding', (name) => {
    expect(classifyHighRiskAction({ name, readOnly: true })).toBeDefined();
  });

  it('keeps schedule_preview (it runs the prompt now) and other unmarked schedule names', () => {
    expect(classifyHighRiskAction({ name: 'schedule_preview' })).toBe('schedule');
    expect(classifyHighRiskAction({ name: 'schedule_task' })).toBe('schedule');
  });

  it.each([
    ['schedule tag', { tags: ['schedule'] }, 'schedule'],
    ['config tag', { tags: ['config'] }, 'config'],
    ['outbound tag', { tags: ['outbound'] }, 'outbound'],
    ['shell tag', { tags: ['shell'] }, 'shell'],
    ['file_write tag', { tags: ['file_write'] }, 'file_write'],
  ] as const)('lets an explicit %s outrank readOnly and the read suffix', (_label, extra, kind) => {
    expect(classifyHighRiskAction({ name: 'schedule_list', readOnly: true, ...extra })).toBe(kind);
  });

  it('lets risk: dangerous and a riskCategory outrank readOnly and the read suffix', () => {
    expect(classifyHighRiskAction({ name: 'schedule_list', readOnly: true, risk: 'dangerous' })).toBe('schedule');
    expect(classifyHighRiskAction({ name: 'config_get', readOnly: true, riskCategory: 'publish' })).toBe('config');
  });

  it('never lifts the built-in side-effect names', () => {
    for (const name of ['bash', 'write_file', 'send_message', 'notify_list', 'send_status']) {
      expect(classifyHighRiskAction({ name, readOnly: true })).toBeDefined();
    }
  });
});

describe('read-only schedule / config tools elsewhere (#1250)', () => {
  it('lets a declared read-only schedule_list skip on-risk approval, but not a write-named variant', () => {
    const tool = (name: string) => ({ name, readOnly: true });
    expect(readOnlyDeclarationApplies(tool('schedule_list'))).toBe(true);
    for (const name of ['addReminder', 'setConfig', 'schedule_add', 'scheduleRemove']) {
      expect(readOnlyDeclarationApplies(tool(name))).toBe(false);
    }
  });

  it('keeps output trust unchanged: schedule_list rows (prompts other people wrote) stay external content', () => {
    const settings = resolveInjectionGuard();
    expect(classifyToolOutput({ name: 'schedule_list', readOnly: true, firstParty: true }, settings)).toBe('external');
    expect(classifyToolOutput({ name: 'config_dump', readOnly: true, firstParty: true }, settings)).toBe('external');
    expect(classifyToolOutput({ name: 'weather', readOnly: true, firstParty: true }, settings)).toBe('trusted');
  });

  it('declares the Host schedule_list read-only, and only it', () => {
    const tools = createScheduleTools({} as never);
    expect(tools.find(entry => entry.name === 'schedule_list')!.definition.readOnly).toBe(true);
    for (const entry of tools.filter(item => item.name !== 'schedule_list')) {
      expect(entry.definition.readOnly).not.toBe(true);
    }
  });
});

describe('TurnToolRuntime: schedule_list after external content (#1250)', () => {
  function turn(approval: ApprovalOutcomePort) {
    return createTurnIngress({
      intent: { kind: 'new' },
      identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
      origin: { kind: 'http', sessionId: 's' },
      principal: { subjectId: 'owner', roles: ['owner'] },
      input: { text: '把早报改到 8 点' },
      session: { key: 'http:s' },
      policy: { permissions: ['owner'], unattended: false },
      capabilities: { tools: [], skills: [] },
      signal: new AbortController().signal,
      ports: { journal: { append: () => undefined }, approval },
    });
  }
  function capability(name: string, extra: Partial<ToolCapability> = {}): ToolCapability {
    return { owner: rootPluginId(), name, qualifiedName: name, description: name, requiresApproval: 'on-risk',
      source: `/tools/${name}.ts`, execute: vi.fn(async () => 'ok'), ...extra };
  }

  it('runs a declared read-only schedule_list without any card, while schedule_update still asks', async () => {
    const asked: string[] = [];
    const approval: ApprovalOutcomePort = {
      available: true,
      requestApproval: async () => true,
      requestApprovalOutcome: async (request) => { asked.push(request.toolName); return { status: 'approved', decision: 'approve-once' }; },
    };
    const runtime = new TurnToolRuntime(turn(approval), [
      capability('schedule_list', { readOnly: true }),
      capability('schedule_update'),
    ]);
    runtime.provenance.record({ kind: 'conversation_context', scene: 'private' });
    for (const id of ['l1', 'l2', 'l3']) {
      await expect(runtime.execute('schedule_list', {}, id)).resolves.toMatchObject({ status: 'completed' });
    }
    expect(asked).toEqual([]);
    await expect(runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 8 * * *' }, 'u1')).resolves.toMatchObject({ status: 'completed' });
    expect(asked).toEqual(['schedule_update']);
  });
});
