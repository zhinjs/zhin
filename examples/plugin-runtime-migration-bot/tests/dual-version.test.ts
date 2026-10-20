import { describe, expect, it, vi } from 'vitest';
import nextHello from '../commands/hello/[name]/index.js';
import statusCard from '../components/status-card/index.js';
import audit from '../middlewares/audit/index.js';

describe('Plugin Runtime migration result', () => {
  it('executes the migrated command definition', async () => {
    const message = {
      $content: [{ type: 'text', data: { text: 'hello Alice' } }],
    };
    const nextResult = await nextHello.execute({
      input: message,
      args: [],
      params: { name: 'Alice' },
    } as never);

    expect(nextResult).toBe('hello Alice');
  });

  it('keeps extracted middleware and component definitions executable', async () => {
    const next = vi.fn(async () => undefined);
    await audit.handle({ input: { id: 'message-1' } } as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(await statusCard.render({ label: 'ready' }, {} as never)).toBe('ready');
  });
});
