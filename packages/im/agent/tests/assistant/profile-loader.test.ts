import { describe, it, expect, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('@zhin.js/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zhin.js/logger')>()),
  getLogger: () => ({ info: vi.fn(), warn, debug: vi.fn(), error: vi.fn() }),
  formatCompact: (fields: Record<string, unknown>) => JSON.stringify(fields),
}));
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadBootstrapWithProfile,
  syncProfileHeartbeatToStore,
  syncProfileRoutinesToStore,
  pruneStaleProfileCronJobs,
  validateAssistantProfile,
  buildScheduleJobFromRoutine,
} from '../../src/assistant/profile-loader.js';
import { ScheduleJobStore } from '../../src/assistant/job-store.js';
import {
  PROFILE_HEARTBEAT_JOB_ID,
  PROFILE_MORNING_BRIEF_JOB_ID,
  PROFILE_BEDTIME_CHECK_JOB_ID,
} from '../../src/assistant/profile-types.js';

describe('Assistant Profile loader', () => {
  it('Profile 覆盖 SOUL，缺失段落回退磁盘文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-'));
    try {
      await writeFile(join(dir, 'SOUL.md'), '# disk soul', 'utf-8');
      await writeFile(join(dir, 'TOOLS.md'), '# disk tools', 'utf-8');
      await writeFile(
        join(dir, 'assistant.profile.yml'),
        `version: 1
persona:
  soul: |
    # profile soul
agents: |
  # profile agents
`,
        'utf-8',
      );

      const { files, profile } = await loadBootstrapWithProfile(dir, { enabled: true });
      expect(profile).not.toBeNull();
      expect(files.find((f) => f.name === 'SOUL.md')?.content).toContain('profile soul');
      expect(files.find((f) => f.name === 'TOOLS.md')?.content).toContain('disk tools');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('syncProfileHeartbeatToStore 写入 every 调度 Job', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-hb-'));
    try {
      const store = new ScheduleJobStore({ dataDir: dir });
      const ok = await syncProfileHeartbeatToStore(store, {
        version: 1,
        routines: { heartbeat: { enabled: true, everyMs: 60_000 } },
      });
      expect(ok).toBe(true);
      const job = await store.getJob(PROFILE_HEARTBEAT_JOB_ID);
      expect(job?.schedule.kind).toBe('every');
      expect(job?.action.kind).toBe('heartbeat');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('syncProfileRoutinesToStore 写入早报与睡前巡检', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-cron-'));
    try {
      const store = new ScheduleJobStore({ dataDir: dir });
      const imDefaults = {
        channel: 'im' as const,
        target: {
          channel: 'im' as const,
          scene: {
            platform: 'icqq',
            endpointKey: '8596238',
            sceneId: '1659488338',
            kind: 'private' as const,
          },
        },
      };
      const count = await syncProfileRoutinesToStore(store, {
        version: 1,
        defaults: { notify: imDefaults },
        routines: {
          morningBrief: { enabled: true, cron: '0 0 8 * * *', prompt: '早报' },
          bedtimeCheck: { enabled: true, cron: '0 0 22 * * *', prompt: '睡前' },
        },
      });
      expect(count).toBe(2);
      const morning = await store.getJob(PROFILE_MORNING_BRIEF_JOB_ID);
      expect(morning?.schedule.kind).toBe('solar');
      expect(morning?.notify).toEqual(imDefaults);
      expect((await store.getJob(PROFILE_BEDTIME_CHECK_JOB_ID))?.action.kind).toBe('agent');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('syncProfileRoutinesToStore 同步 weatherReport 等扩展 routine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-weather-'));
    try {
      const store = new ScheduleJobStore({ dataDir: dir });
      const imDefaults = {
        channel: 'im' as const,
        target: {
          channel: 'im' as const,
          scene: {
            platform: 'icqq',
            endpointKey: '1',
            sceneId: 'u1',
            kind: 'private' as const,
          },
        },
      };
      const count = await syncProfileRoutinesToStore(store, {
        version: 1,
        defaults: { notify: imDefaults },
        routines: {
          weatherReport: {
            enabled: true,
            scheduleKind: 'workday',
            cron: '0 0 9 * * *',
            prompt: '天气',
            notify: { channel: 'im' },
          },
        },
      });
      expect(count).toBe(1);
      const job = await store.getJob('assistant-profile-weatherReport');
      expect(job?.schedule).toEqual({ kind: 'workday', cron: '0 0 9 * * *' });
      expect(job?.notify).toEqual(imDefaults);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips a routine with an unknown time zone and still syncs the others (#1250 b99)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-tz-'));
    try {
      const store = new ScheduleJobStore({ dataDir: dir });
      const count = await syncProfileRoutinesToStore(store, {
        version: 1,
        routines: {
          morningBrief: { enabled: true, cron: '0 0 8 * * *', prompt: '早报', tz: 'Mars/Olympus' },
          bedtimeCheck: { enabled: true, cron: '0 0 22 * * *', prompt: '睡前', tz: 'Asia/Shanghai' },
        },
      });
      expect(count).toBe(1);
      expect(await store.getJob(PROFILE_MORNING_BRIEF_JOB_ID)).toBeFalsy();
      expect((await store.getJob(PROFILE_BEDTIME_CHECK_JOB_ID))?.schedule).toMatchObject({ tz: 'Asia/Shanghai' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('pruneStaleProfileCronJobs 移除 profile 中已删的 cron job', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-prune-'));
    try {
      const store = new ScheduleJobStore({ dataDir: dir });
      await store.upsertJob({
        id: PROFILE_MORNING_BRIEF_JOB_ID,
        enabled: true,
        schedule: { kind: 'solar', cron: '0 8 * * *' },
        action: { kind: 'agent', prompt: '早报' },
        notify: { channel: 'silent' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        state: {},
        source: 'profile',
      });
      await store.upsertJob({
        id: PROFILE_HEARTBEAT_JOB_ID,
        enabled: true,
        schedule: { kind: 'every', everyMs: 60_000 },
        action: { kind: 'heartbeat', prompt: 'ping' },
        notify: { channel: 'silent' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        state: {},
        source: 'profile',
      });
      const removed = await pruneStaleProfileCronJobs(store, { version: 1, routines: {} });
      expect(removed).toBe(1);
      expect(await store.getJob(PROFILE_MORNING_BRIEF_JOB_ID)).toBeUndefined();
      expect(await store.getJob(PROFILE_HEARTBEAT_JOB_ID)).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the recorded state and createdAt when a restart re-syncs an unchanged routine (#1250)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-state-'));
    try {
      const store = new ScheduleJobStore({ dataDir: dir });
      const profile = { version: 1, routines: { weatherReport: { scheduleKind: 'workday' as const, cron: '0 0 9 * * *', prompt: '天气' } } };
      await syncProfileRoutinesToStore(store, profile);
      await store.updateJobState('assistant-profile-weatherReport', { lastExecutedAt: 123, lastStatus: 'ok', nextRunAtMs: 456 });
      const before = await store.getJob('assistant-profile-weatherReport');
      await syncProfileRoutinesToStore(store, profile);
      const after = await store.getJob('assistant-profile-weatherReport');
      expect(after?.state).toEqual({ lastExecutedAt: 123, lastStatus: 'ok', nextRunAtMs: 456 });
      expect(after?.createdAt).toBe(before?.createdAt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('aligns the persisted heartbeat with routines.heartbeat.enabled: false (#1250)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-heartbeat-off-'));
    try {
      const store = new ScheduleJobStore({ dataDir: dir });
      await syncProfileHeartbeatToStore(store, { version: 1, routines: { heartbeat: { everyMs: 60_000 } } });
      await store.updateJobState(PROFILE_HEARTBEAT_JOB_ID, { nextRunAtMs: 1, lastExecutedAt: 2 });
      expect((await store.getJob(PROFILE_HEARTBEAT_JOB_ID))?.enabled).toBe(true);

      expect(await syncProfileHeartbeatToStore(store, { version: 1, routines: { heartbeat: { enabled: false, everyMs: 60_000 } } })).toBe(false);
      const disabled = await store.getJob(PROFILE_HEARTBEAT_JOB_ID);
      expect(disabled?.enabled).toBe(false);
      expect(disabled?.state).toEqual({ lastExecutedAt: 2 });

      // Switching it back on re-enables the same job.
      await syncProfileHeartbeatToStore(store, { version: 1, routines: { heartbeat: { everyMs: 60_000 } } });
      expect((await store.getJob(PROFILE_HEARTBEAT_JOB_ID))?.enabled).toBe(true);
      // No profile at all (assistant.profile disabled): the store is left as it is.
      expect(await syncProfileHeartbeatToStore(store, null)).toBe(false);
      expect((await store.getJob(PROFILE_HEARTBEAT_JOB_ID))?.enabled).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('validateAssistantProfile 拒绝非法 everyMs', () => {
    const errors = validateAssistantProfile({
      version: 1,
      routines: { heartbeat: { everyMs: 0 } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('routine 的 agent 写入 action.agent，省略或空白时为默认 Agent (#1250 b52)', () => {
    const routine = { cron: '0 0 8 * * *', prompt: '早报' };
    expect(buildScheduleJobFromRoutine(PROFILE_MORNING_BRIEF_JOB_ID, '早报', { ...routine, agent: ' news ' }).action)
      .toEqual({ kind: 'agent', prompt: '早报', agent: 'news' });
    expect(buildScheduleJobFromRoutine(PROFILE_MORNING_BRIEF_JOB_ID, '早报', routine).action).toEqual({ kind: 'agent', prompt: '早报' });
    expect(buildScheduleJobFromRoutine(PROFILE_MORNING_BRIEF_JOB_ID, '早报', { ...routine, agent: '  ' }).action).toEqual({ kind: 'agent', prompt: '早报' });
    expect(validateAssistantProfile({ version: 1, routines: { morningBrief: { ...routine, agent: 3 as never } } }))
      .toContain('routines.morningBrief.agent must be an Agent name');
    expect(validateAssistantProfile({ version: 1, routines: { morningBrief: { ...routine, agent: 'news' } } })).toEqual([]);
  });

  it('每次同步都按 Profile 重新声明 routine 的 agent (#1250 b52)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-agent-'));
    try {
      const store = new ScheduleJobStore({ dataDir: dir });
      const profile = (agent?: string) => ({ version: 1, routines: { morningBrief: { cron: '0 0 8 * * *', prompt: '早报', ...(agent ? { agent } : {}) } } });
      await syncProfileRoutinesToStore(store, profile('news'));
      expect((await store.getJob(PROFILE_MORNING_BRIEF_JOB_ID))?.action).toEqual({ kind: 'agent', prompt: '早报', agent: 'news' });
      await syncProfileRoutinesToStore(store, profile());
      expect((await store.getJob(PROFILE_MORNING_BRIEF_JOB_ID))?.action).toEqual({ kind: 'agent', prompt: '早报' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('warns when a routine names an Agent that is not configured, and still syncs it (#1250 b55)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-agent-missing-'));
    try {
      warn.mockClear();
      const store = new ScheduleJobStore({ dataDir: dir });
      const profile = { version: 1, routines: {
        morningBrief: { cron: '0 0 8 * * *', prompt: '早报', agent: 'ghost' },
        bedtimeCheck: { cron: '0 0 22 * * *', prompt: '巡检', agent: 'news' },
        weatherReport: { cron: '0 0 7 * * *', prompt: '天气' },
      } };
      expect(await syncProfileRoutinesToStore(store, profile, { agents: ['zhin', 'news'] })).toBe(3);
      expect(warn).toHaveBeenCalledOnce();
      expect(JSON.parse(warn.mock.calls[0]![0] as string)).toEqual({
        op: 'profile_routine_agent_missing', routine: 'morningBrief', job: PROFILE_MORNING_BRIEF_JOB_ID, agent: 'ghost', available: 'zhin,news',
      });
      expect((await store.getJob(PROFILE_MORNING_BRIEF_JOB_ID))?.action).toEqual({ kind: 'agent', prompt: '早报', agent: 'ghost' });
      // Without the configured Agents nothing is checked.
      warn.mockClear();
      await syncProfileRoutinesToStore(store, profile);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
