import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { AiAnnouncements } from '../../src/announcements.js';
import type { DecisionEventInput } from '../../src/decision-events.js';
import { ANNOUNCEMENT_DRAFT_TOOL_NAME, createNativeAnnouncementToolFeatures } from '../../src/plugin-runtime/native-announcement-tools.js';
import { RESERVED_TOOL_NAMES } from '../../src/reserved-tools.js';

function harness() {
  const events: DecisionEventInput[] = [];
  const store = new AiAnnouncements({ audit: () => ({ record: (input) => { events.push(input); } }) });
  return { store, events };
}

function toolContext(origin: ToolExecutionContext['origin']): ToolExecutionContext {
  return {
    locale: 'zh-CN',
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn-1',
    sessionKey: 'session',
    origin,
    principal: { subjectId: 'u-42', roles: [] },
    policy: {},
  } as unknown as ToolExecutionContext;
}

describe('announcement_draft tool', () => {
  it('is safe, reserved, and only creates a draft for the current group', async () => {
    const { store, events } = harness();
    const [feature] = createNativeAnnouncementToolFeatures(() => store);
    expect(feature!.name).toBe(ANNOUNCEMENT_DRAFT_TOOL_NAME);
    expect(feature!.definition.risk).toBe('safe');
    expect(feature!.definition.requiresApproval).toBe('never');
    expect(RESERVED_TOOL_NAMES).toContain('announcement_draft');
    const result = await feature!.definition.execute({ content: '明天停电' }, toolContext({
      kind: 'im', platform: 'icqq', endpoint: '10086', scope: 'group', sceneId: '123',
    }));
    expect(result).toContain('NOT been sent');
    const [row] = await store.list({ platform: 'icqq', sceneId: 'group:123' });
    expect(row).toMatchObject({ status: 'draft', createdVia: 'model', createdBy: 'u-42', endpoint: '10086', content: '明天停电' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'announcement', reasonCode: 'announcement_drafted', actor: 'model', turnId: 'turn-1' });
  });

  it('requires an explicit scene outside a group', async () => {
    const { store } = harness();
    const [feature] = createNativeAnnouncementToolFeatures(() => store);
    const privateChat = toolContext({ kind: 'im', platform: 'icqq', endpoint: '10086', scope: 'private', sceneId: '42' });
    await expect(feature!.definition.execute({ content: 'x' }, privateChat)).rejects.toThrow(/scene_id/);
    await feature!.definition.execute({ content: 'x', scene_id: 'group:555' }, privateChat);
    expect(await store.list({ platform: 'icqq', sceneId: 'group:555' })).toHaveLength(1);
  });
});
