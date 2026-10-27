import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { AiSessionEvents } from '../../src/session-events.js';
import type { DecisionEventInput } from '../../src/decision-events.js';
import {
  SESSION_EVENT_CREATE_TOOL_NAME,
  createNativeSessionEventToolFeatures,
  parseSessionEventAt,
} from '../../src/plugin-runtime/native-session-event-tools.js';
import { RESERVED_TOOL_NAMES } from '../../src/reserved-tools.js';

const NOW = Date.UTC(2026, 9, 27, 10, 0, 0);

function harness() {
  const events: DecisionEventInput[] = [];
  const store = new AiSessionEvents({ now: () => NOW, audit: () => ({ record: (input) => { events.push(input); } }) });
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

const group = { kind: 'im', platform: 'icqq', endpoint: '10086', scope: 'group', sceneId: '123' } as ToolExecutionContext['origin'];

describe('session_event_create tool', () => {
  it('is safe, reserved, and creates an event for the current group only', async () => {
    const { store, events } = harness();
    const [feature] = createNativeSessionEventToolFeatures(() => store);
    expect(feature!.name).toBe(SESSION_EVENT_CREATE_TOOL_NAME);
    expect(feature!.definition.risk).toBe('safe');
    expect(feature!.definition.requiresApproval).toBe('never');
    expect(RESERVED_TOOL_NAMES).toContain('session_event_create');
    const schema = feature!.definition.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).not.toContain('scene_id');
    expect(Object.keys(schema.properties)).not.toContain('platform');

    const result = await feature!.definition.execute({
      title: '社团周会', at: '2026-10-28T20:00:00+08:00', remind_before_minutes: [60], scene_id: 'group:999',
    }, toolContext(group));
    expect(result).toContain('scheduled');
    expect(await store.list({ platform: 'icqq', sceneId: 'group:999' })).toHaveLength(0);
    const [row] = await store.list({ platform: 'icqq', sceneId: 'group:123' });
    expect(row).toMatchObject({
      status: 'scheduled', createdVia: 'model', createdBy: 'u-42', endpoint: '10086', title: '社团周会',
      at: Date.UTC(2026, 9, 28, 12, 0, 0), remindBefore: [60 * 60_000],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'schedule', reasonCode: 'schedule_event_created', actor: 'model', turnId: 'turn-1' });
  });

  it('refuses private chats and non-IM turns', async () => {
    const { store } = harness();
    const [feature] = createNativeSessionEventToolFeatures(() => store);
    const privateChat = toolContext({ kind: 'im', platform: 'icqq', endpoint: '10086', scope: 'private', sceneId: '42' } as ToolExecutionContext['origin']);
    await expect(feature!.definition.execute({ title: 'x', at: '2026-10-28T20:00:00Z' }, privateChat)).rejects.toThrow(/current session only/);
    await expect(feature!.definition.execute({ title: 'x', at: '2026-10-28T20:00:00Z' }, toolContext({ kind: 'console' } as never))).rejects.toThrow(/group or channel/);
  });

  it('only accepts times with an explicit offset', () => {
    expect(parseSessionEventAt('2026-10-28T20:00:00+08:00')).toBe(Date.UTC(2026, 9, 28, 12));
    expect(parseSessionEventAt('2026-10-28T12:00Z')).toBe(Date.UTC(2026, 9, 28, 12));
    expect(parseSessionEventAt(Date.UTC(2026, 9, 28, 12))).toBe(Date.UTC(2026, 9, 28, 12));
    expect(() => parseSessionEventAt('2026-10-28T20:00:00')).toThrow(/explicit UTC offset/);
    expect(() => parseSessionEventAt('明天八点')).toThrow();
  });
});
