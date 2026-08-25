import { describe, expect, it, vi } from 'vitest';
import zanCommand, { parseZanArgs } from '../commands/赞我.js';

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

  it('通过当前 operation 的 IcqqClient 发起点赞', async () => {
    const sendLike = vi.fn(async () => true);
    const context = {
      sender: { id: '10001' },
      args: [],
      segments: [],
      $client: { sendLike },
    };

    await expect(zanCommand.execute(context as never)).resolves.toBe('已给 10001 点赞 10 次');
    expect(sendLike).toHaveBeenCalledWith(10001, 10);
  });

  it('返回 IcqqClient 未确认与异常结果', async () => {
    const base = { sender: { id: '10001' }, args: [], segments: [] };

    await expect(zanCommand.execute({
      ...base,
      $client: { sendLike: vi.fn(async () => false) },
    } as never)).resolves.toBe('点赞失败：ICQQ 未确认操作成功');

    await expect(zanCommand.execute({
      ...base,
      $client: { sendLike: vi.fn(async () => { throw new Error('offline'); }) },
    } as never)).resolves.toBe('点赞失败：offline');
  });
});
