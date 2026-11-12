import { describe, expect, it, vi } from 'vitest';
import { checkBuiltinPermit, toPermissionSubject } from '@zhin.js/permission';
import sendText from '../agents/wecom/skills/wecom/tools/send_text/index.js';

function subject(level: 'global' | 'conversation') {
  return toPermissionSubject({
    clientAdapter: 'wecom',
    conversation: { endpoint: { adapter: 'wecom', id: 'bot' }, kind: 'private', id: 'u1' },
    sender: { id: 'u1', chatRole: 'owner', chatRoleLevels: { owner: level, admin: level, trusted: level } },
  } as never);
}

describe('wecom_send_text', () => {
  it('messages any user outside the current conversation, so only a global zhin owner may use it', () => {
    expect(sendText.permissions).toEqual(['owner@global']);
    expect(sendText.permissions!.every((p) => checkBuiltinPermit(p, subject('global')))).toBe(true);
    expect(sendText.permissions!.every((p) => checkBuiltinPermit(p, subject('conversation')))).toBe(false);
  });
});

describe('wecom_send_text delivery', () => {
  function context(origin: unknown) {
    const send = vi.fn(async (_request: unknown) => ({ status: 'sent' }));
    const sendTextMessage = vi.fn();
    return { send, sendTextMessage, context: { locale: 'en', signal: new AbortController().signal, owner: { id: 'wecom-plugin' },
      use: () => ({ send }), $client: { sendTextMessage }, origin } as never };
  }

  it('goes through the outbound chain from the current account', async () => {
    const endpoint = { adapter: 'wecom', id: 'wecom\0corp' };
    const f = context({ kind: 'im', platform: 'wecom', conversation: { endpoint, kind: 'private', id: 'me' } });
    expect(await sendText.execute({ user_id: 'zhangsan', content: 'hi' }, f.context)).toMatchObject({ success: true });
    expect(f.sendTextMessage).not.toHaveBeenCalled();
    expect(f.send).toHaveBeenCalledExactlyOnceWith({ requester: 'wecom-plugin', conversation: { endpoint, kind: 'private', id: 'zhangsan' }, content: 'hi' });
  });

  it('needs a WeCom conversation to pick the sending account', async () => {
    const f = context({ kind: 'console' });
    expect(await sendText.execute({ user_id: 'zhangsan', content: 'hi' }, f.context)).toMatchObject({ success: false });
    expect(f.send).not.toHaveBeenCalled();
  });
});
