import { describe, it, expect, vi } from 'vitest';
import { MessageCommand, type Message } from 'zhin.js';

function msg(text: string): Message<any> {
  return {
    $id: '1',
    $adapter: 'icqq',
    $endpoint: '79158',
    $content: [{ type: 'text', data: { text } }],
    $raw: text,
    $sender: { id: 'u1', name: 'User' },
    $reply: vi.fn(),
    $channel: { id: 'g1', type: 'group' },
    $timestamp: Date.now(),
  } as Message<any>;
}

const mockPlugin = {
  contextIsReady: () => false,
  inject: () => null,
} as any;

describe('teach command matching', () => {
  const command = new MessageCommand('teach [...payload:text]').action((_m, r) => {
    const raw = Array.isArray(r.params.payload)
      ? r.params.payload.join(' ')
      : String(r.params.payload ?? '');
    return raw;
  });

  it('captures space-separated question and answer', async () => {
    const r = await command.handle(msg('teach hello 你好'), mockPlugin);
    expect(r).toBe('hello 你好');
  });

  it('captures pipe-separated pair', async () => {
    const r = await command.handle(msg('teach 几点了|下午三点'), mockPlugin);
    expect(r).toBe('几点了|下午三点');
  });

  it('longer command registered first wins over teach', async () => {
    const teach = new MessageCommand('teach [...payload:text]').action(() => 'TEACH');
    const list = new MessageCommand('teach-list [page:number]').action(() => 'LIST');
    const regex = new MessageCommand('teach-regex [...payload:text]').action(() => 'REGEX');
    const commands = [list, regex, teach];
    const run = async (text: string) => {
      const m = msg(text);
      for (const cmd of commands) {
        const r = await cmd.handle(m, mockPlugin);
        if (r) return r;
      }
      return undefined;
    };
    expect(await run('teach-list')).toBe('LIST');
    expect(await run('teach-regex ^a$ 回复')).toBe('REGEX');
    expect(await run('teach hello 你好')).toBe('TEACH');
  });

  it('legacy two text params do not match without quotes', async () => {
    const legacy = new MessageCommand('teach <question:text> <answer:text>').action(() => 'ok');
    const r = await legacy.handle(msg('teach hello 你好'), mockPlugin);
    expect(r).toBeUndefined();
  });
});
