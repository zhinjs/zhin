import { describe, expect, it } from 'vitest';
import {
  messageToIMDeliveryTarget,
  resolveIMSceneSessionId,
  sceneRefFromMessage,
  sceneRefToSendOptions,
} from '../src/im-scene.js';

function message(
  adapter: string,
  endpointId: string,
  kind: 'private' | 'group' | 'channel',
  id: string,
  senderId = 'u1',
  parent?: { kind: 'group' | 'channel' | 'guild'; id: string },
) {
  return {
    clientAdapter: adapter,
    endpointId,
    conversation: {
      endpoint: { adapter, id: endpointId },
      kind,
      id,
      ...(parent ? { parent } : {}),
    },
    sender: { id: senderId },
  } as any;
}

describe('IM scene contract', () => {
  it('extracts a group scene from message context', () => {
    expect(sceneRefFromMessage(message('qq', 'bot1', 'group', 'g1'))).toEqual({
      platform: 'qq', endpointKey: 'bot1', sceneId: 'g1', kind: 'group', senderId: 'u1',
    });
  });

  it('uses sender id as the private scene id', () => {
    expect(sceneRefFromMessage(message('qq', 'bot1', 'private', 'legacy-channel'))?.sceneId).toBe('u1');
  });

  it('preserves parent scene for temporary private sessions', () => {
    expect(sceneRefFromMessage(message('qq', 'bot1', 'private', 'u1', 'u1', { kind: 'group', id: 'g1' }))?.parent)
      .toEqual({ kind: 'group', sceneId: 'g1' });
  });

  it('preserves guild parent for sub-channel messages', () => {
    expect(sceneRefFromMessage(message('icqq', 'bot1', 'channel', '634415832', 'u1', { kind: 'guild', id: '650779094005186335' }))?.parent)
      .toEqual({ kind: 'guild', sceneId: '650779094005186335' });
  });

  it('normalizes parent kind channel to guild', () => {
    expect(sceneRefFromMessage(message('icqq', 'bot1', 'channel', 'ch1', 'u1', { kind: 'channel', id: 'g1' }))?.parent)
      .toEqual({ kind: 'guild', sceneId: 'g1' });
  });

  it('round-trips channel scene with guild parent to SendOptions', () => {
    const target = messageToIMDeliveryTarget(message('icqq', '8596238', 'channel', '634415832', 'u1', { kind: 'guild', id: '650779094005186335' }));
    expect(sceneRefToSendOptions(target!, 'nihao')).toEqual({
      context: 'icqq', endpoint: '8596238', id: '634415832', type: 'channel',
      parent: { type: 'guild', id: '650779094005186335' }, content: 'nihao',
    });
  });

  it('converts a scene delivery target to SendOptions', () => {
    expect(sceneRefToSendOptions({
      channel: 'im', scene: { platform: 'qq', endpointKey: 'bot1', sceneId: 'g1', kind: 'group' }, quoteId: 'm1',
    }, 'hello')).toEqual({ context: 'qq', endpoint: 'bot1', id: 'g1', type: 'group', content: 'hello', quoteId: 'm1' });
  });

  it('keeps session id format stable across scene kinds', () => {
    expect(resolveIMSceneSessionId({ platform: 'telegram', endpointKey: 'bot1', sceneId: 'c1', kind: 'channel' }))
      .toBe('telegram:bot1:channel:c1');
  });

  it('builds a delivery target from a message', () => {
    expect(messageToIMDeliveryTarget(message('qq', 'bot1', 'channel', 'ch1'))).toEqual({
      channel: 'im', scene: { platform: 'qq', endpointKey: 'bot1', sceneId: 'ch1', kind: 'channel', senderId: 'u1' },
    });
  });
});
