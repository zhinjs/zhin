import { describe, expect, it } from 'vitest';
import { parseIcqqGetMsgResponse } from '../src/get-msg.js';

describe('parseIcqqGetMsgResponse', () => {
  it('parses element array message', () => {
    const payload = parseIcqqGetMsgResponse('mid/1', {
      time: 100,
      sender: { user_id: 1, nickname: 'Bob' },
      message: [{ type: 'text', text: 'hello' }],
      raw_message: 'hello',
    });
    expect(payload.messageId).toBe('mid/1');
    expect(payload.sender?.name).toBe('Bob');
    expect(Array.isArray(payload.content)).toBe(true);
  });

  it('parses raw_message string', () => {
    const payload = parseIcqqGetMsgResponse('99', {
      raw_message: 'plain',
    });
    expect(payload.content).toEqual([{ type: 'text', data: { text: 'plain' } }]);
  });

  it('injects forward segment when multimsg resid is in message array', () => {
    const payload = parseIcqqGetMsgResponse('fwd-1', {
      message: [
        {
          type: 'json',
          data: {
            app: 'com.tencent.multimsg',
            meta: { detail: { resid: 'RESID-IN-GET-MSG' } },
          },
        },
      ],
      raw_message: '[聊天记录]',
    });
    expect(payload.content[0]).toEqual({
      type: 'forward',
      data: { id: 'RESID-IN-GET-MSG', resid: 'RESID-IN-GET-MSG' },
    });
  });
});
