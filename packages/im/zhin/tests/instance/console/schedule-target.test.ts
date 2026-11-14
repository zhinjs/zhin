import { describe, expect, it } from 'vitest';
import { describeScheduleTarget, parseScheduleTargetSpec, scheduleEndpointLookup, withScheduleTargets } from '../../../src/instance/console/schedule-target.js';

const im = (endpointKey = 'sandbox-bot') => ({ channel: 'im', target: { channel: 'im', scene: { platform: 'sandbox', endpointKey, sceneId: 'u1', kind: 'private' } } });
const lookup = scheduleEndpointLookup({
  get: (adapter, key) => {
    if (adapter === 'boom') throw new Error('unknown adapter');
    return key === 'sandbox-bot' ? { name: '沙盒机器人', adapter } : null;
  },
});

describe('schedule delivery target (#1250)', () => {
  it('resolves the account display name and conversation', () => {
    expect(describeScheduleTarget(im(), lookup!)).toEqual({ resolved: true, display: '沙盒机器人（sandbox）· 私聊 u1' });
  });

  it('marks a target whose account no longer exists, or a missing / incomplete target, as unresolved', () => {
    expect(describeScheduleTarget(im('gone'), lookup!)).toEqual({ resolved: false, reason: 'endpoint_not_found', display: 'gone（sandbox）· 私聊 u1' });
    expect(describeScheduleTarget({ channel: 'im' }, lookup!)).toEqual({ resolved: false, reason: 'missing_target' });
    expect(describeScheduleTarget({ channel: 'im', target: { scene: { platform: 'sandbox' } } }, lookup!)).toEqual({ resolved: false, reason: 'incomplete_target' });
    expect(describeScheduleTarget({ channel: 'im', target: { scene: { platform: 'boom', endpointKey: 'x', sceneId: 'y', kind: 'group' } } }, lookup!).resolved).toBe(false);
  });

  it('describes non-IM channels and attaches `target` to rows', () => {
    expect(describeScheduleTarget({ channel: 'silent' }, null)).toEqual({ resolved: true, display: '不投递' });
    expect(describeScheduleTarget({ channel: 'log' }, null)).toEqual({ resolved: true, display: '仅记录日志' });
    expect(describeScheduleTarget(im('gone'), null).resolved).toBe(true);
    expect(withScheduleTargets([{ id: 'a', notify: im('gone') }], lookup)[0]!.target.resolved).toBe(false);
  });

  it('parses <adapter>:<endpoint>:<kind>:<id>', () => {
    expect(parseScheduleTargetSpec('qq:bot:group:123:4')).toEqual({ target: { channel: 'im', scene: { platform: 'qq', endpointKey: 'bot', kind: 'group', sceneId: '123:4' } } });
    expect(parseScheduleTargetSpec('qq:bot:group')).toHaveProperty('error');
    expect(parseScheduleTargetSpec('qq:bot:room:1')).toHaveProperty('error');
    expect(parseScheduleTargetSpec('qq::group:1')).toHaveProperty('error');
  });
});
