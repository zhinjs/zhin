/**
 * NapCat 入站消息治理测试：去重、自发过滤、消息归一化
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InboundMessageDeduper, isSelfMessage, normalizeMessage } from '../src/napcat-inbound';
import type { NapCatMessageEvent, MessageSegment } from '../src/types';

describe('InboundMessageDeduper', () => {
  let deduper: InboundMessageDeduper;

  beforeEach(() => {
    deduper = new InboundMessageDeduper();
  });

  it('首次消息应通过', () => {
    expect(deduper.shouldProcess('msg-1')).toBe(true);
  });

  it('重复消息应被过滤', () => {
    deduper.shouldProcess('msg-1');
    expect(deduper.shouldProcess('msg-1')).toBe(false);
  });

  it('不同消息 ID 互不影响', () => {
    deduper.shouldProcess('msg-1');
    expect(deduper.shouldProcess('msg-2')).toBe(true);
  });

  it('clear() 后应允许相同消息通过', () => {
    deduper.shouldProcess('msg-1');
    deduper.clear();
    expect(deduper.shouldProcess('msg-1')).toBe(true);
  });
});

describe('isSelfMessage', () => {
  it('message_sent 事件应判为自发', () => {
    const ev = { post_type: 'message_sent', self_id: 12345, user_id: 12345 } as NapCatMessageEvent;
    expect(isSelfMessage(ev)).toBe(true);
  });

  it('self_id === user_id 应判为自发', () => {
    const ev = { post_type: 'message', self_id: 12345, user_id: 12345 } as NapCatMessageEvent;
    expect(isSelfMessage(ev)).toBe(true);
  });

  it('self_id !== user_id 应为他人消息', () => {
    const ev = { post_type: 'message', self_id: 12345, user_id: 99999 } as NapCatMessageEvent;
    expect(isSelfMessage(ev)).toBe(false);
  });
});

describe('normalizeMessage', () => {
  it('数组直接返回', () => {
    const segs: MessageSegment[] = [{ type: 'text', data: { text: 'hi' } }];
    expect(normalizeMessage(segs)).toEqual(segs);
  });

  it('字符串包装为 text segment', () => {
    expect(normalizeMessage('hello')).toEqual([{ type: 'text', data: { text: 'hello' } }]);
  });

  it('空字符串返回单元素数组', () => {
    expect(normalizeMessage('')).toEqual([{ type: 'text', data: { text: '' } }]);
  });

  it('非法输入返回空数组', () => {
    expect(normalizeMessage(null as any)).toEqual([]);
    expect(normalizeMessage(undefined as any)).toEqual([]);
  });
});
