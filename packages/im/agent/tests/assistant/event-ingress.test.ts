import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssistantEventIngress } from '../../src/assistant/event-ingress.js';
import { AssistantJobEngine } from '../../src/assistant/job-engine.js';
import { AssistantJobStore } from '../../src/assistant/job-store.js';

describe('AssistantEventIngress', () => {
  let dataDir: string;
  let store: AssistantJobStore;
  let engine: AssistantJobEngine;
  let ingress: AssistantEventIngress;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'zhin-event-ingress-'));
    store = new AssistantJobStore({ dataDir, legacyDualWrite: false });
    engine = {
      runJobNow: vi.fn(async () => {}),
    } as unknown as AssistantJobEngine;
    ingress = new AssistantEventIngress({
      store,
      engine,
      eventsConfig: { enabled: true, allowedSources: ['homeassistant'] },
    });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('未启用时拒绝', async () => {
    const off = new AssistantEventIngress({
      store,
      engine,
      eventsConfig: { enabled: false },
    });
    const result = await off.handle({ source: 'homeassistant', action: { kind: 'agent', prompt: 'hi' } });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('校验 source 与 action/jobId', async () => {
    expect((await ingress.handle({})).error).toContain('source');
    expect((await ingress.handle({ source: 'x' })).error).toContain('jobId or action');
    expect((await ingress.handle({
      source: 'homeassistant',
      jobId: 'j1',
      action: { kind: 'agent', prompt: 'a' },
    })).error).toContain('mutually exclusive');
  });

  it('白名单拒绝未知 source', async () => {
    const result = await ingress.handle({
      source: 'unknown',
      action: { kind: 'agent', prompt: 'ping' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('allowedSources');
  });

  it('内联 action 入队并写入 JobStore', async () => {
    const result = await ingress.handle({
      source: 'homeassistant',
      type: 'state_changed',
      eventId: 'evt-1',
      action: { kind: 'agent', prompt: '检查客厅温度' },
      label: '温度告警',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('queued');
    expect(result.jobId).toMatch(/^event_/);
    expect(engine.runJobNow).toHaveBeenCalledWith(result.jobId);

    const job = await store.getJob(result.jobId!);
    expect(job?.schedule.kind).toBe('event');
    expect(job?.schedule.eventId).toBe('evt-1');
    expect(job?.action).toEqual({ kind: 'agent', prompt: '检查客厅温度' });
    expect(job?.source).toBe('event');
  });

  it('eventId 幂等去重', async () => {
    const body = {
      source: 'homeassistant',
      eventId: 'dup-42',
      action: { kind: 'agent', prompt: 'once' },
    };
    const first = await ingress.handle(body);
    const second = await ingress.handle(body);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.status).toBe('deduped');
    expect(second.deduped).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    expect(engine.runJobNow).toHaveBeenCalledTimes(1);
  });

  it('触发已存在 jobId', async () => {
    await store.upsertJob({
      id: 'cron_existing',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      action: { kind: 'agent', prompt: '早报' },
      notify: { channel: 'silent' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: {},
    });

    const result = await ingress.handle({ source: 'homeassistant', jobId: 'cron_existing' });
    expect(result.ok).toBe(true);
    expect(result.jobId).toBe('cron_existing');
    expect(engine.runJobNow).toHaveBeenCalledWith('cron_existing');
  });

  it('限流', async () => {
    const limited = new AssistantEventIngress({
      store,
      engine,
      eventsConfig: { enabled: true, allowedSources: [], rateLimitPerMinute: 2 },
    });
    const body = { source: 'script', action: { kind: 'agent', prompt: 'x' } };
    expect((await limited.handle(body)).ok).toBe(true);
    expect((await limited.handle(body)).ok).toBe(true);
    const third = await limited.handle(body);
    expect(third.ok).toBe(false);
    expect(third.error).toContain('rate limit');
  });
});
