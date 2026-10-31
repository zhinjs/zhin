import { describe, it, expect, vi } from 'vitest';
import { defineGameCommandAliasMiddleware } from '../src/command-alias.js';

function makeContext(content: string) {
  return {
    input: {
      sender: { id: 'alice' },
      content,
      $reply: vi.fn(async () => undefined),
    },
  };
}

describe('defineGameCommandAliasMiddleware', () => {
  it('命中别名且无 action 时以空串调 run 并回复', async () => {
    const run = vi.fn(async (_action: string, input: unknown) => { await (input as ReturnType<typeof makeContext>['input']).$reply('HELP'); return true; });
    const mw = defineGameCommandAliasMiddleware({ aliases: ['21点', 'bj'], run });
    const context = makeContext('21点');
    const next = vi.fn(async () => undefined);

    await mw.handle(context as never, next);

    expect(run).toHaveBeenCalledWith('', context.input, context);
    expect(context.input.$reply).toHaveBeenCalledWith('HELP');
    expect(next).not.toHaveBeenCalled();
  });

  it('命中别名且带 action 时透传剩余文本', async () => {
    const run = vi.fn(async (_action: string, input: unknown) => { await (input as ReturnType<typeof makeContext>['input']).$reply('OK'); return true; });
    const mw = defineGameCommandAliasMiddleware({ aliases: ['21点', 'bj'], run });
    const context = makeContext('bj 开始 加倍');
    const next = vi.fn(async () => undefined);

    await mw.handle(context as never, next);

    expect(run).toHaveBeenCalledWith('开始 加倍', context.input, context);
    expect(context.input.$reply).toHaveBeenCalledWith('OK');
    expect(next).not.toHaveBeenCalled();
  });

  it('首词非别名时放行', async () => {
    const run = vi.fn(async (_action: string, input: unknown) => { await (input as ReturnType<typeof makeContext>['input']).$reply('OK'); return true; });
    const mw = defineGameCommandAliasMiddleware({ aliases: ['21点', 'bj'], run });
    const context = makeContext('猜数 开始');
    const next = vi.fn(async () => undefined);

    await mw.handle(context as never, next);

    expect(run).not.toHaveBeenCalled();
    expect(context.input.$reply).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('支持带 / 前缀的别名', async () => {
    const run = vi.fn(async (_action: string, input: unknown) => { await (input as ReturnType<typeof makeContext>['input']).$reply('STARTED'); return true; });
    const mw = defineGameCommandAliasMiddleware({ aliases: ['21点', 'bj'], run });
    const context = makeContext('/21点 开始');
    const next = vi.fn(async () => undefined);

    await mw.handle(context as never, next);

    expect(run).toHaveBeenCalledWith('开始', context.input, context);
    expect(context.input.$reply).toHaveBeenCalledWith('STARTED');
    expect(next).not.toHaveBeenCalled();
  });

  it('run 返回 false 时放行', async () => {
    const run = vi.fn(async () => false);
    const mw = defineGameCommandAliasMiddleware({ aliases: ['21点', 'bj'], run });
    const context = makeContext('21点 开始');
    const next = vi.fn(async () => undefined);

    await mw.handle(context as never, next);

    expect(run).toHaveBeenCalledWith('开始', context.input, context);
    expect(context.input.$reply).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
