import { describe, expect, it, vi } from 'vitest';
import type { EndpointEventEmitter } from '@zhin.js/adapter';
import type { IncomingRequest } from '@zhin.js/core';
import { receiveOneBotLikeSideEvent } from '../src/dispatch.js';

describe('receiveOneBotLikeSideEvent gateway', () => {
  it('expires request action ports when gateway dispatch settles', async () => {
    let captured: IncomingRequest | undefined;
    const approve = vi.fn(async () => undefined);
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name === 'request.receive') captured = payload as IncomingRequest;
    };
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11',
      endpointKey: 'bot',
      raw: { post_type: 'request', request_type: 'friend', flag: 'f1', user_id: 'u1' },
      approve,
    });
    await expect(captured?.$approve()).rejects.toThrow('action port expired');
    expect(approve).not.toHaveBeenCalled();
  });

  it('keeps request dispatch alive until fire-and-forget actions settle', async () => {
    let release!: () => void;
    const action = new Promise<void>((resolve) => { release = resolve; });
    let captured: IncomingRequest | undefined;
    const approve = vi.fn(() => action);
    let dispatchSettled = false;
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name !== 'request.receive') return;
      const request = payload as IncomingRequest;
      captured = request;
      void request.$approve();
    };
    const dispatch = receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11',
      endpointKey: 'bot',
      raw: { post_type: 'request', request_type: 'friend', flag: 'f1', user_id: 'u1' },
      approve,
    }).finally(() => { dispatchSettled = true; });

    await Promise.resolve();
    await Promise.resolve();
    expect(approve).toHaveBeenCalledOnce();
    expect(dispatchSettled).toBe(false);
    release();
    await expect(dispatch).resolves.toBe('request');
    await expect(captured?.$approve()).rejects.toThrow('action port expired');
  });

  it('normalizes member targets and reaction operations at the adapter boundary', async () => {
    const receiveNotice = vi.fn(async (_notice: unknown) => undefined);
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name === 'notice.receive') await receiveNotice(payload);
    };
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11',
      endpointKey: 'bot',
      raw: { post_type: 'notice', notice_type: 'group_increase', group_id: 1, user_id: 2, time: 3 },
    });
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11',
      endpointKey: 'bot',
      raw: { post_type: 'notice', notice_type: 'group_msg_emoji_like', set: false, group_id: 1, user_id: 2, message_id: 4, code: 'x', time: 5 },
    });

    expect(receiveNotice.mock.calls[0]?.[0]).toMatchObject({
      name: 'notice.group.member_increase',
      actor: undefined,
      target: { id: '2' },
    });
    expect(receiveNotice.mock.calls[1]?.[0]).toMatchObject({
      name: 'notice.group.emoji_reaction',
      operation: 'removed',
      messageId: '4',
    });
  });

  it('threads the joining member nickname from the notice into target.name', async () => {
    const receiveNotice = vi.fn(async (_notice: unknown) => undefined);
    const emit: EndpointEventEmitter = async (name, payload) => {
      if (name === 'notice.receive') await receiveNotice(payload);
    };
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'icqq',
      platform: 'icqq',
      endpointKey: 'bot',
      raw: { post_type: 'notice', notice_type: 'group', sub_type: 'increase', group_id: 1, user_id: 2, nickname: ' 小明 ', time: 3 },
    });
    expect(receiveNotice.mock.calls[0]?.[0]).toMatchObject({
      name: 'notice.group.member_increase',
      target: { id: '2', name: '小明' },
    });
  });

  it('does not use a user or bot id as a missing group conversation', async () => {
    const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
    await receiveOneBotLikeSideEvent(emit, {
      adapter: 'onebot11', endpointKey: 'bot',
      raw: { post_type: 'notice', notice_type: 'group_increase', user_id: 2, time: 3 },
    });
    expect(emit).toHaveBeenCalledWith('notice.receive', expect.objectContaining({ conversation: undefined }));
  });

  it.each([
    [{ post_type: 'system.login.qrcode' }, 'system.login.qrcode'],
    [{ post_type: 'system.online' }, 'system.online'],
    [{ post_type: 'system.login', sub_type: 'qrcode' }, 'system.login.qrcode'],
    [{ post_type: 'system.login.qrcode', sub_type: 'qrcode' }, 'system.login.qrcode'],
    [{ post_type: 'meta_event', meta_event_type: 'lifecycle', sub_type: 'connect' }, 'system.lifecycle.connect'],
  ])('preserves independent system names for %j', async (raw, name) => {
    const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
    await receiveOneBotLikeSideEvent(emit, { adapter: 'onebot11', endpointKey: 'bot', raw });
    expect(emit).toHaveBeenCalledWith('system.receive', expect.objectContaining({ type: 'system', name }));
    expect(emit.mock.calls[0]?.[1]).not.toHaveProperty('conversation');
  });
});
