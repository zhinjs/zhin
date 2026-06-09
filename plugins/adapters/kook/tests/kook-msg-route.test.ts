import { describe, it, expect } from 'vitest';
import {
  encodeKookMsgRef,
  parseKookMsgRef,
  plainKookMsgId,
  resolveKookRoutes,
  routeFromSceneType,
  routeFromSendType,
  encodeKookReactionId,
  parseKookReactionId,
  isKookApiGoneResult,
  isKookApiSuccess,
  isKookMsgGoneError,
  shouldStopDeleteAfterResponse,
} from '../src/kook-msg-route.js';

describe('kook-msg-route', () => {
  it('encode/parse 出站 msg ref', () => {
    const ref = encodeKookMsgRef('channel', 'uuid-1');
    expect(ref).toBe('kook:channel:uuid-1');
    expect(parseKookMsgRef(ref)).toEqual({ route: 'channel', msgId: 'uuid-1' });
    expect(plainKookMsgId(ref)).toBe('uuid-1');
  });

  it('无路由前缀时保持原 msgId', () => {
    expect(parseKookMsgRef('plain-id')).toEqual({ msgId: 'plain-id' });
  });

  it('sceneType / sendType 映射', () => {
    expect(routeFromSceneType('private')).toBe('direct');
    expect(routeFromSceneType('channel')).toBe('channel');
    expect(routeFromSendType('private')).toBe('direct');
    expect(routeFromSendType('group')).toBe('channel');
  });

  it('delete 有路由时只走单路由', () => {
    expect(resolveKookRoutes('delete', 'channel')).toEqual(['channel']);
    expect(resolveKookRoutes('add', 'channel')).toEqual(['channel', 'direct']);
    expect(resolveKookRoutes('delete')).toEqual(['channel', 'direct']);
  });

  it('reactionId 编解码', () => {
    const rid = encodeKookReactionId('direct', 'dm-1', '⏳');
    expect(rid).toBe('reaction:direct:dm-1:⏳');
    expect(parseKookReactionId(rid)).toEqual({ route: 'direct', emoji: '⏳' });
  });

  it('404 视为已删除', () => {
    expect(isKookMsgGoneError(new Error('code(404): 该数据不存在'))).toBe(true);
    expect(isKookMsgGoneError(new Error('other'))).toBe(false);
    expect(isKookApiGoneResult({ code: 404, message: '该数据不存在' })).toBe(true);
    expect(isKookApiGoneResult({ code: 0 })).toBe(false);
  });

  it('成功响应与 delete 停止条件', () => {
    expect(isKookApiSuccess({ code: 0 })).toBe(true);
    expect(isKookApiSuccess({})).toBe(true);
    expect(isKookApiSuccess({ code: 400 })).toBe(false);
    expect(shouldStopDeleteAfterResponse({}, 2)).toBe(true);
    expect(shouldStopDeleteAfterResponse({ code: 400 }, 2)).toBe(false);
    expect(shouldStopDeleteAfterResponse({ code: 400 }, 1)).toBe(true);
  });
});
