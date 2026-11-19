/** #1250 b55: a `schedule_preview` run reaches the turn engine marked as a preview. */
import { describe, expect, it, vi } from 'vitest';
import { scheduleTurnExecutionProfile } from '../../src/plugin-runtime/host/schedule-turn-profile.js';
import { createTaskExecutor } from '../../src/task-executor.js';
import type { ScheduleTurnExecutionRequest } from '../../src/schedule-domain/execution-domain.js';
import { createNotificationRouter } from '../../src/assistant/notification-router.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const security = { execPreset: 'readonly' as const, allowedDomains: ['example.com'] };

describe('scheduleTurnExecutionProfile', () => {
  it('marks a preview run, and only a preview run', () => {
    expect(scheduleTurnExecutionProfile({ preview: true, security } as never)).toMatchObject({ kind: 'schedule', preview: true });
    expect(scheduleTurnExecutionProfile({ preview: false, security } as never)).not.toHaveProperty('preview');
  });
});

describe('schedule_preview given a whole creation request (#1250 b55)', () => {
  it('runs the preview as a preview turn and creates no job', async () => {
    const requests: ScheduleTurnExecutionRequest[] = [];
    const executor = createTaskExecutor({
      dataDir: mkdtempSync(join(tmpdir(), 'zhin-preview-profile-')),
      router: createNotificationRouter({ resolveAdapter: () => undefined }),
      turn: { execute: vi.fn(async (request: ScheduleTurnExecutionRequest) => {
        requests.push(request);
        return { status: 'completed', output: [{ type: 'text', content: '提醒你喝水' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } as never;
      }) },
    });
    const result = await executor.preview('明天 8 点提醒我喝水', {
      origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'private', sceneId: 'u1' },
      principal: { subjectId: 'u1', roles: ['user'] },
      sessionKey: 'im:qq:bot:private:u1',
    } as never);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.preview).toBe(true);
    expect(scheduleTurnExecutionProfile(requests[0]!)).toMatchObject({ preview: true });
    expect(result).toMatchObject({ success: true });
    await executor.dispose();
  });
});
