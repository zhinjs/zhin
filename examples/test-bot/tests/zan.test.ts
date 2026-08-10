import { describe, expect, it } from 'vitest';
import { parseZanArgs } from '../commands/赞我.js';

describe('parseZanArgs', () => {
  it('无参数时给发送者默认次数', () => {
    expect(parseZanArgs({ args: [], segments: [], senderId: '10001' }))
      .toEqual({ userId: 10001, times: 10 });
  });

  it('单个数字当作次数（赞自己）', () => {
    expect(parseZanArgs({ args: ['20'], segments: [], senderId: '10001' }))
      .toEqual({ userId: 10001, times: 20 });
  });

  it('QQ 号 + 次数', () => {
    expect(parseZanArgs({ args: ['123456789', '5'], segments: [], senderId: '10001' }))
      .toEqual({ userId: 123456789, times: 5 });
  });

  it('mention 优先，次数封顶 20', () => {
    expect(parseZanArgs({
      args: ['99'],
      segments: [{ type: 'mention', data: { target: '20002' } }],
      senderId: '10001',
    })).toEqual({ userId: 20002, times: 20 });
  });

  it('仅 QQ 号时用默认次数', () => {
    expect(parseZanArgs({ args: ['123456789'], segments: [], senderId: '10001' }))
      .toEqual({ userId: 123456789, times: 10 });
  });
});
