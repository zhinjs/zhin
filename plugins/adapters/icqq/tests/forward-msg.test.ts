import { describe, expect, it } from 'vitest';

import {
  extractForwardResidFromJsonElement,
  normalizeForwardMsgResponse,
} from '../src/forward-msg.js';

describe('forward-msg', () => {
  it('extracts the explicit merged-forward identity from an inbound element', () => {
    expect(extractForwardResidFromJsonElement({
      type: 'json',
      data: {
        app: 'com.tencent.multimsg',
        meta: { detail: { resid: 'B3E5A2F1-0000-0000-ABCD-1234567890AB' } },
      },
    })).toBe('B3E5A2F1-0000-0000-ABCD-1234567890AB');
  });

  it('normalizes merged-forward speakers as neutral actors without model roles', () => {
    const entries = normalizeForwardMsgResponse({
      messages: [{
        sender: { nickname: 'Alice', user_id: 111 },
        time: 1780306187,
        message: [{ type: 'text', text: '第一条' }],
      }],
    });

    expect(entries).toEqual([{
      actor: { id: '111', displayName: 'Alice' },
      timestamp: 1780306187000,
      segments: [{ type: 'text', data: { text: '第一条' } }],
    }]);
    expect(entries[0]).not.toHaveProperty('role');
  });
});
