import { applyOutboundInteractivePolicy } from '../../src/plugin-runtime/im/outbound-segments.js';
import { RuntimeInteractiveRouter } from '../../src/plugin-runtime/im/interactive-router.js';
import type { Message } from '../../src/plugin-runtime/im/contracts.js';

const conversation = { endpoint: { adapter: 'test', id: 'account-1' }, kind: 'group' as const, id: 'room-1' };
const message = (content: string, overrides: Partial<Message> = {}) => ({ content, conversation, generation: 1, ...overrides }) as Message;

describe('disabled manual payloads on text platforms', () => {
  it('does not map a disabled action to an executable reply number', async () => {
    const router = new RuntimeInteractiveRouter();
    const handler = vi.fn(() => true);
    router.register('task:', handler);
    const projected = applyOutboundInteractivePolicy([{ type: 'keyboard', data: { rows: [[
      { id: 'cancel', label: '取消任务', payload: 'task:1:cancel', disabled: true },
    ]] } }], 'text', map => router.rememberFallback(conversation, 1, map));
    expect(await router.dispatch(message('1'))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(projected)).not.toContain('1. 取消任务');
    expect(JSON.stringify(projected)).toContain('当前无可用操作。');
    expect(JSON.stringify(projected)).not.toContain('回复数字');
    const customHint = applyOutboundInteractivePolicy([{ type: 'keyboard', data: { rows: [[
      { id: 'cancel', label: '取消任务', payload: 'task:1:cancel', disabled: true },
    ]], fallback: { hint: '回复数字选择操作', map: { '1': 'task:1:cancel' } } } }], 'text', map => router.rememberFallback(conversation, 1, map));
    expect(JSON.stringify(customHint)).toContain('当前无可用操作');
    expect(JSON.stringify(customHint)).not.toContain('回复数字');
  });

  it('aligns enabled actions after mixed disabled positions and runtime renumbering', async () => {
    const router = new RuntimeInteractiveRouter();
    const handler = vi.fn(() => true);
    router.register('task:', handler);
    // Reserve a previous keyboard number to prove display uses allocated labels.
    router.rememberFallback(conversation, 1, { '1': 'earlier:1:action' });
    const projected = applyOutboundInteractivePolicy([{ type: 'keyboard', data: { rows: [[
      { id: 'off', label: '停用操作', payload: 'task:1:off', disabled: true },
      { id: 'run', label: '运行', payload: 'task:1:run' },
      { id: 'off2', label: '其他停用', payload: 'task:1:off2', disabled: true },
      { id: 'stop', label: '停止', payload: 'task:1:stop' },
    ]] } }], 'text', map => router.rememberFallback(conversation, 1, map));
    const text = JSON.stringify(projected);
    expect(text).toContain('2. 运行');
    expect(text).toContain('3. 停止');
    expect(text).toContain('— 停用操作 (不可用)');
    expect(text).not.toMatch(/\d\. (?:停用操作|其他停用)/u);
    expect(router.resolvePayload(message('2'))).toBe('task:1:run');
    expect(router.resolvePayload(message('3'))).toBe('task:1:stop');
    expect(await router.dispatch(message('4'))).toBe(false);
    expect(await router.dispatch(message('2', { conversation: { ...conversation, id: 'other-room' } }))).toBe(false);
    expect(await router.dispatch(message('2', { conversation: { ...conversation, endpoint: { ...conversation.endpoint, id: 'other-account' } } }))).toBe(false);
    expect(await router.dispatch(message('2', { generation: 2 }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(await router.dispatch(message('2'))).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('filters disabled aliases from explicit maps without inventing unmapped actions', async () => {
    const router = new RuntimeInteractiveRouter();
    const handler = vi.fn(() => true);
    router.register('task:', handler);
    const rows = [[
      { id: 'off', label: '取消', payload: 'task:1:cancel', disabled: true },
      { id: 'run', label: '运行', payload: 'task:1:run' },
    ]];
    const projected = applyOutboundInteractivePolicy([{ type: 'keyboard', data: {
      rows, fallback: { hint: '选择操作', map: { '5': 'task:1:cancel', cancel: 'task:1:cancel' } },
    } }], 'text', map => router.rememberFallback(conversation, 1, map));
    expect(await router.dispatch(message('1'))).toBe(false);
    expect(await router.dispatch(message('5'))).toBe(false);
    expect(await router.dispatch(message('cancel'))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(projected)).not.toContain('1. 运行');
    expect(JSON.stringify(projected)).not.toContain('5. 取消');
  });

  it('keeps only enabled explicit labels and aliases', async () => {
    const router = new RuntimeInteractiveRouter();
    const projected = applyOutboundInteractivePolicy([{ type: 'keyboard', data: {
      rows: [[
        { id: 'off', label: '取消', payload: 'task:1:cancel', disabled: true },
        { id: 'run', label: '运行', payload: 'task:1:run' },
      ]], fallback: { hint: '选择操作', map: { '5': 'task:1:cancel', '9': 'task:1:run', run: 'task:1:run' } },
    } }], 'text', map => router.rememberFallback(conversation, 1, map));
    expect(JSON.stringify(projected)).toContain('1. 运行');
    expect(JSON.stringify(projected)).toContain('run. 运行');
    expect(router.resolvePayload(message('1'))).toBe('task:1:run');
    expect(router.resolvePayload(message('run'))).toBe('task:1:run');
    expect(router.resolvePayload(message('5'))).toBeUndefined();
  });
});
