import { describe, expect, it, vi } from 'vitest';
import nextHello from '../commands/hello/[name:string].js';
import statusCard from '../components/status-card.js';
import { legacyHello } from '../legacy/hello.js';
import audit from '../middlewares/audit.js';

describe('dual-version migration tracer', () => {
  it('preserves command callback behavior across the compatibility boundary', async () => {
    const message = {
      $content: [{ type: 'text', data: { text: 'hello Alice' } }],
    };
    const legacyResult = await legacyHello.handle(message as never, {} as never);
    const nextResult = await nextHello.execute({
      input: message,
      args: [],
      params: { name: 'Alice' },
    } as never);

    expect(nextResult).toBe(legacyResult);
    expect(nextResult).toBe('hello Alice');
  });

  it('keeps extracted middleware and component definitions executable', async () => {
    const next = vi.fn(async () => undefined);
    await audit.handle({ input: { id: 'message-1' } } as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(await statusCard.render({ label: 'ready' }, {} as never)).toBe('ready');
  });
});
