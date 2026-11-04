import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RuntimeMessage } from '../../../../../../packages/im/core/src/plugin-runtime/im/contracts.js';
import { describe, expect, it, vi } from 'vitest';
import { AiControlPlane, AiSessionOps, DecisionEventLog, SessionProfileStore, type TurnRequest } from '@zhin.js/agent';
import { MemoryConversationEventStore, type ConversationEvent } from '@zhin.js/im-contract';
import { rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { AgentTurnIngressRoute } from '../../../../src/plugin-runtime/agent/turn/ingress-route.js';
import { SceneEventIngress } from '../../../../src/plugin-runtime/agent/turn/scene-event-ingress.js';
import {
  auditControlGate,
  checkControlAtIngress,
  checkControlAtOutbound,
} from '../../../../src/plugin-runtime/agent/turn/control-gate.js';
import { createDecisionAudit, decisionScopeOf } from '../../../../src/plugin-runtime/agent/turn/decision-audit.js';
import { ControlBlockedOutboundError, createRuntimeProactiveOutbound } from '../../../../src/plugin-runtime/agent/runtime-factory.js';

const rows = (log: DecisionEventLog) => log.recent().map((r) => [r.kind, r.outcome, r.reasonCode]);
const g1 = { platform: 'icqq', scope: 'group' as const, sceneId: 'g1' };

describe('control gate helpers', () => {
  it('maps the scene to the session-profile sceneKey and applies mention_only only to unaddressed entries', async () => {
    const plane = new AiControlPlane();
    await plane.set({ expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { mention_only: true } }], actorId: 'op' });
    expect(checkControlAtIngress(plane, g1, false)).toMatchObject({ blocked: true, reasonCode: 'control_mention_only', outcome: 'skip' });
    expect(checkControlAtIngress(plane, g1, true)).toEqual({ blocked: false });
    expect(checkControlAtOutbound(plane, g1)).toEqual({ blocked: false });
    expect(checkControlAtIngress(plane, { ...g1, sceneId: 'g2' }, false)).toEqual({ blocked: false });
  });

  it('passes through without a control plane', () => {
    expect(checkControlAtIngress(undefined, g1, false)).toEqual({ blocked: false });
    expect(checkControlAtOutbound(undefined, g1)).toEqual({ blocked: false });
  });

  it('fails closed when evaluation throws', () => {
    const broken = { gate: () => { throw new Error('bug'); }, outboundGate: () => { throw new Error('bug'); } } as unknown as AiControlPlane;
    expect(checkControlAtIngress(broken, g1, true)).toMatchObject({ blocked: true, reasonCode: 'control_emergency_stop', level: 'unavailable' });
    expect(checkControlAtOutbound(broken, g1)).toMatchObject({ blocked: true, reasonCode: 'control_emergency_stop' });
  });

  it('audits control_gate + model_skip with the control_* code', async () => {
    const log = new DecisionEventLog();
    const audit = createDecisionAudit(log, decisionScopeOf({ turnId: 't', platform: 'icqq', scope: 'group', sceneId: 'g1' }));
    auditControlGate(audit, { blocked: true, switch: 'muted', level: 'session', reasonCode: 'control_muted_session', outcome: 'deny' }, { source: 'message' });
    expect(rows(log)).toEqual([['control_gate', 'deny', 'control_muted_session'], ['model_skip', 'skip', 'control_muted_session']]);
    expect(log.recent()[0]).toMatchObject({ actor: 'policy', reasonDetail: 'session:muted', sceneId: 'group:g1' });
  });
});

function ingressHarness(options: { plane: AiControlPlane; log: DecisionEventLog; sessions?: SessionProfileStore;
  execute?: (request: TurnRequest) => Promise<unknown>; group?: boolean; sessionOps?: AiSessionOps }) {
  const endpoint = { adapter: 'root', id: 'root\u0000zhin.adapter\u0000fixture' };
  const conversation = options.group
    ? { endpoint, kind: 'group' as const, id: 'g1' }
    : { endpoint, kind: 'private' as const, id: 'user' };
  const snapshot = { root: rootPluginId(), resources: new Map(), tree: new Map(), projections: new Map(), capabilities: new Map() } as unknown as RuntimeSnapshot;
  const reply = vi.fn(async () => ({ status: 'sent' as const }));
  const message = new RuntimeMessage(
    {
      conversation: conversation,
      content: 'hello',
      sender: { id: 'user' },
      metadata: {},
      segments: [],
      endpointId: 'bot',
      mentioned: false,
    },
    { generation: 1, reply: reply, clientAdapter: 'fixture' },
  );
  const executeLeased = vi.fn(async (_lease: unknown, _requester: unknown, request: TurnRequest) =>
    options.execute ? options.execute(request) : { status: 'completed', output: [] });
  const observeInbound = vi.fn(async () => ({ blocked: null }));
  const route = new AgentTurnIngressRoute({
    projectRoot: process.cwd(), runtime: { executeLeased } as never,
    im: { createInteraction: () => ({ ask: vi.fn() }) } as never,
    ingress: { read: async () => ({ agents: [], tools: [] }) } as never,
    agent: {
      service: {
        getBindingRegistry: () => ({ requireZhinBinding: () => ({ name: 'zhin', providerAlias: 'fixture', model: 'fixture' }) }),
        getTriggerConfig: () => ({ enabled: true }),
        getAgentConfig: () => ({}),
      },
      agent: {
        getControlPlane: () => options.plane,
        getDecisionEvents: () => options.log,
        getSessionOps: () => options.sessionOps,
        getUserProfiles: () => ({ sessions: { observeInbound } }),
      },
    } as never,
  });
  return { run: () => route.route(message, { value: snapshot, active: true } as never, rootPluginId(), undefined), reply, executeLeased, observeInbound };
}

describe('IM ingress with the control plane', () => {
  it.each([
    [{ emergency_stop: true }, 'control_emergency_stop'],
    [{ muted: true }, 'control_muted_instance'],
    [{ read_only: true }, 'control_read_only'],
  ] as const)('%j blocks before session-gate: no model, no outbound', async (flags, reasonCode) => {
    const plane = new AiControlPlane();
    const log = new DecisionEventLog();
    await plane.set({ expectedRevision: 0, instance: flags, actorId: 'op' });
    const flow = ingressHarness({ plane, log });
    await flow.run();
    await log.idle();
    expect(flow.executeLeased).not.toHaveBeenCalled();
    expect(flow.observeInbound).not.toHaveBeenCalled();
    expect(flow.reply).not.toHaveBeenCalled();
    expect(rows(log)).toEqual([['control_gate', 'deny', reasonCode], ['model_skip', 'skip', reasonCode]]);
  });

  it('mention_only lets a private (addressed) message through to session-gate and the model', async () => {
    const plane = new AiControlPlane();
    const log = new DecisionEventLog();
    await plane.set({ expectedRevision: 0, instance: { mention_only: true }, actorId: 'op' });
    const flow = ingressHarness({ plane, log });
    await flow.run();
    expect(flow.observeInbound).toHaveBeenCalledOnce();
    expect(flow.executeLeased).toHaveBeenCalledOnce();
  });

  it('a cold-field temporary mention_only (ADR 0037 slice C) skips unaddressed group messages as policy:mention_only', async () => {
    const plane = new AiControlPlane();
    const fresh = new DecisionEventLog();
    plane.addTemporaryMentionOnly({ platform: 'fixture', sceneId: 'group:g1', durationMs: 60_000 });
    const flow = ingressHarness({ plane, log: fresh, group: true });
    await expect(flow.run()).resolves.toBe(false);
    await fresh.idle();
    expect(flow.observeInbound).not.toHaveBeenCalled();
    expect(flow.executeLeased).not.toHaveBeenCalled();
    expect(rows(fresh)).toEqual([['control_gate', 'skip', 'control_mention_only'], ['model_skip', 'skip', 'control_mention_only']]);
    expect(fresh.recent()[0]).toMatchObject({ actor: 'policy', reasonDetail: 'policy:mention_only', sceneId: 'group:g1' });
    expect(plane.snapshot().revision).toBe(0);
  });

  it('a switch flipped mid-turn suppresses the reply (outbound backstop)', async () => {
    const plane = new AiControlPlane();
    const log = new DecisionEventLog();
    const flow = ingressHarness({ plane, log, execute: async (request) => {
      await plane.set({ expectedRevision: 0, instance: { emergency_stop: true }, actorId: 'op' });
      const delivered = await request.ports.reply!.send([{ type: 'message', segments: [{ type: 'text', data: { text: 'hi' } }] }] as never);
      expect(delivered).toEqual({ status: 'suppressed' });
      return { status: 'completed', output: [] };
    } });
    await flow.run();
    await log.idle();
    expect(flow.executeLeased).toHaveBeenCalledOnce();
    expect(flow.reply).not.toHaveBeenCalled();
    expect(rows(log)).toContainEqual(['control_gate', 'deny', 'control_emergency_stop']);
    expect(rows(log)).toContainEqual(['outbound', 'skip', 'outbound_suppressed']);
  });
});

// ── scene event wake ─────────────────────────────────────────────────────────

const endpoint = Object.freeze({ id: 'icqq', adapter: 'icqq' });
const group = Object.freeze({ endpoint, kind: 'group' as const, id: 'g1' });
let seq = 0;
function ev(type: string, extra: Record<string, unknown>): ConversationEvent {
  seq += 1;
  return { eventId: `c${seq}`, conversation: group, timestamp: Date.now(), type, ...extra } as unknown as ConversationEvent;
}

function sceneHarness(plane: AiControlPlane, onTurn?: () => Promise<void>) {
  const store = new MemoryConversationEventStore();
  const log = new DecisionEventLog();
  const deliver = vi.fn(async () => ({ status: 'sent' as const }));
  const executeTurn = vi.fn(async (request: any) => {
    await onTurn?.();
    await request.ports.reply.send([{ type: 'message', segments: [{ type: 'text', data: { text: 'hi' } }] }]);
    return { status: 'completed' as const, output: [], usage: {} };
  });
  const sessions = new SessionProfileStore();
  const observe = vi.spyOn(sessions, 'observeInbound');
  const ingress = new SceneEventIngress({
    projectRoot: '/tmp/project',
    triggerConfig: () => ({ sceneEvents: { conversations: ['icqq:g1'] } }),
    reader: () => store,
    sessions: () => sessions,
    decisionEvents: () => log,
    controlPlane: () => plane,
    deliver,
    executeTurn: executeTurn as never,
    timeoutMs: () => 10_000,
  });
  const wake = async () => {
    const event = ev('member.joined', { member: { id: 'u1' } });
    const { sequence } = await store.append(event);
    const result = await ingress.wakeScene({ key: 'icqq:g1', conversation: group, throughSequence: sequence,
      items: [{ sequence, event, selfIds: ['10000'], endpointId: '10000' }] });
    await log.idle();
    return result;
  };
  return { wake, log, deliver, executeTurn, observe };
}

describe('scene event wake with the control plane', () => {
  it('mention_only skips scene wakes before session-gate (not addressed)', async () => {
    const plane = new AiControlPlane();
    await plane.set({ expectedRevision: 0, instance: { mention_only: true }, actorId: 'op' });
    const flow = sceneHarness(plane);
    expect(await flow.wake()).toEqual({ kind: 'skipped', reason: 'control:mention_only' });
    expect(flow.executeTurn).not.toHaveBeenCalled();
    expect(flow.observe).not.toHaveBeenCalled();
    expect(rows(flow.log)).toEqual([['control_gate', 'skip', 'control_mention_only'], ['model_skip', 'skip', 'control_mention_only']]);
  });

  it('session muted blocks only that scene', async () => {
    const plane = new AiControlPlane();
    await plane.set({ expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { muted: true } }], actorId: 'op' });
    const flow = sceneHarness(plane);
    expect(await flow.wake()).toEqual({ kind: 'skipped', reason: 'control:muted' });
    expect(rows(flow.log)[0]).toEqual(['control_gate', 'deny', 'control_muted_session']);
  });

  it('a switch flipped during the wake turn suppresses delivery', async () => {
    const plane = new AiControlPlane();
    const flow = sceneHarness(plane, async () => { await plane.set({ expectedRevision: 0, instance: { read_only: true }, actorId: 'op' }); });
    await flow.wake();
    expect(flow.executeTurn).toHaveBeenCalledOnce();
    expect(flow.deliver).not.toHaveBeenCalled();
    expect(rows(flow.log)).toContainEqual(['control_gate', 'deny', 'control_read_only']);
  });
});

describe('proactive outbound with the control plane', () => {
  it('refuses to send under emergency_stop and audits the block', async () => {
    const plane = new AiControlPlane();
    const log = new DecisionEventLog();
    const send = vi.fn(async () => ({ messageId: 'm1' }));
    const outbound = createRuntimeProactiveOutbound({ endpoints: { send } } as never, () => plane, () => log);
    const ctx = { source: 'scheduled' as const, scene: { platform: 'icqq', endpointKey: '10000', kind: 'group' as const, sceneId: 'g1' } };
    await expect(outbound.send(ctx, 'hello')).resolves.toBe('m1');
    await plane.set({ expectedRevision: 0, instance: { emergency_stop: true }, actorId: 'op' });
    await expect(outbound.send(ctx, 'hello')).rejects.toBeInstanceOf(ControlBlockedOutboundError);
    await expect(outbound.sendElements(ctx, [])).rejects.toBeInstanceOf(ControlBlockedOutboundError);
    await log.idle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows(log).slice(0, 2)).toEqual([['control_gate', 'deny', 'control_emergency_stop'], ['outbound', 'skip', 'outbound_suppressed']]);
  });
});

// ── the model has no way to change the switches ──────────────────────────────

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === 'tests') return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe('control plane writers', () => {
  it('only the Console control-set action writes the switches (no Agent tool does)', () => {
    const repo = join(__dirname, '../../../../../..');
    const roots = ['basic/cli/src', 'packages/im/agent/src', 'packages/im/core/src', 'plugins'].map((dir) => join(repo, dir));
    const writers = roots.flatMap((root) => { try { return sourceFiles(root); } catch { return []; } })
      .filter((file) => /getControlPlane\(\)\??\.set\(|controlPlane\??\.set\(|\.set\(\{\s*expectedRevision/u.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repo, file));
    expect(writers).toEqual([]);
    const rpc = readFileSync(join(repo, 'basic/cli/src/plugin-runtime/console/control-plane-rpc.ts'), 'utf8');
    expect(rpc).toMatch(/target\.set\(/u);
  });
});
