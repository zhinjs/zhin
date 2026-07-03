import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadBootstrapWithProfile,
  syncProfileHeartbeatToStore,
  syncProfileCronRoutinesToStore,
  pruneStaleProfileCronJobs,
  validateAssistantProfile,
} from '../../src/assistant/profile-loader.js';
import { AssistantJobStore } from '../../src/assistant/job-store.js';
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
      const store = new AssistantJobStore({ dataDir: dir });
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

  it('syncProfileCronRoutinesToStore 写入早报与睡前巡检', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-cron-'));
    try {
      const store = new AssistantJobStore({ dataDir: dir });
      const imDefaults = {
        channel: 'im' as const,
        target: {
          channel: 'im' as const,
          scene: {
            platform: 'icqq',
            endpointId: '8596238',
            sceneId: '1659488338',
            kind: 'private' as const,
          },
        },
      };
      const count = await syncProfileCronRoutinesToStore(store, {
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

  it('syncProfileCronRoutinesToStore 同步 weatherReport 等扩展 routine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-weather-'));
    try {
      const store = new AssistantJobStore({ dataDir: dir });
      const imDefaults = {
        channel: 'im' as const,
        target: {
          channel: 'im' as const,
          scene: {
            platform: 'icqq',
            endpointId: '1',
            sceneId: 'u1',
            kind: 'private' as const,
          },
        },
      };
      const count = await syncProfileCronRoutinesToStore(store, {
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

  it('pruneStaleProfileCronJobs 移除 profile 中已删的 cron job', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zhin-profile-prune-'));
    try {
      const store = new AssistantJobStore({ dataDir: dir });
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

  it('validateAssistantProfile 拒绝非法 everyMs', () => {
    const errors = validateAssistantProfile({
      version: 1,
      routines: { heartbeat: { everyMs: 0 } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
