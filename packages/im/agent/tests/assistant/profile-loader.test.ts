import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadBootstrapWithProfile,
  syncProfileHeartbeatToStore,
  syncProfileCronRoutinesToStore,
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
      const store = new AssistantJobStore({ dataDir: dir, legacyDualWrite: false });
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
      const store = new AssistantJobStore({ dataDir: dir, legacyDualWrite: false });
      const count = await syncProfileCronRoutinesToStore(store, {
        version: 1,
        routines: {
          morningBrief: { enabled: true, cron: '0 8 * * *', prompt: '早报' },
          bedtimeCheck: { enabled: true, cron: '0 22 * * *', prompt: '睡前' },
        },
      });
      expect(count).toBe(2);
      expect((await store.getJob(PROFILE_MORNING_BRIEF_JOB_ID))?.schedule.kind).toBe('cron');
      expect((await store.getJob(PROFILE_BEDTIME_CHECK_JOB_ID))?.action.kind).toBe('agent');
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
