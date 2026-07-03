import { describe, expect, it } from 'vitest';
import {
  messageToIMDeliveryTarget,
  resolveIMSceneSessionId,
  sceneRefFromMessage,
  sceneRefToSendOptions,
} from '../src/im-scene.js';

describe('IM scene contract', () => {
  it('extracts a group scene from message context', () => {
    expect(sceneRefFromMessage({
      $adapter: 'qq',
      $endpoint: 'bot1',
      $channel: { type: 'group', id: 'g1' },
      $sender: { id: 'u1' },
    })).toEqual({
      platform: 'qq',
      endpointId: 'bot1',
      sceneId: 'g1',
      kind: 'group',
      senderId: 'u1',
    });
  });

  it('uses sender id as the private scene id', () => {
    expect(sceneRefFromMessage({
      $adapter: 'qq',
      $endpoint: 'bot1',
      $channel: { type: 'private', id: 'legacy-channel' },
      $sender: { id: 'u1' },
    })?.sceneId).toBe('u1');
  });

  it('preserves parent scene for temporary private sessions', () => {
    expect(sceneRefFromMessage({
      $adapter: 'qq',
      $endpoint: 'bot1',
      $channel: {
        type: 'private',
        id: 'u1',
        parent: { type: 'group', id: 'g1' },
      },
      $sender: { id: 'u1' },
    })?.parent).toEqual({
      kind: 'group',
      sceneId: 'g1',
    });
  });

  it('converts a scene delivery target to SendOptions', () => {
    expect(sceneRefToSendOptions({
      channel: 'im',
      scene: {
        platform: 'qq',
        endpointId: 'bot1',
        sceneId: 'g1',
        kind: 'group',
      },
      quoteId: 'm1',
    }, 'hello')).toEqual({
      context: 'qq',
      endpoint: 'bot1',
      id: 'g1',
      type: 'group',
      content: 'hello',
      quoteId: 'm1',
    });
  });

  it('keeps session id format stable across scene kinds', () => {
    expect(resolveIMSceneSessionId({
      platform: 'telegram',
      endpointId: 'bot1',
      sceneId: 'c1',
      kind: 'channel',
    })).toBe('telegram:bot1:channel:c1');
  });

  it('builds a delivery target from a message', () => {
    expect(messageToIMDeliveryTarget({
      $adapter: 'qq',
      $endpoint: 'bot1',
      $channel: { type: 'channel', id: 'ch1' },
      $sender: { id: 'u1' },
      $quote_id: 'q1',
    })).toEqual({
      channel: 'im',
      scene: {
        platform: 'qq',
        endpointId: 'bot1',
        sceneId: 'ch1',
        kind: 'channel',
        senderId: 'u1',
      },
      quoteId: 'q1',
    });
  });
});
