import { describe, expect, it, vi } from 'vitest';
import { AgentTurnIngressRoute } from '../../src/plugin-runtime/agent-turn-ingress-route.js';

describe('AgentTurnIngressRoute', () => {
  it('adapts the durable Workroom pre-route through the IngressRoute interface', async () => {
    const preRoute = vi.fn().mockResolvedValue(true);
    const route = new AgentTurnIngressRoute({
      projectRoot: process.cwd(),
      runtime: {} as never,
      im: {} as never,
      ingress: {} as never,
      agent: {} as never,
      execution: {} as never,
      humanIngress: { preRoute } as never,
    });
    const message = {} as never;

    await expect(route.preRoute(message, {} as never, {} as never, 42)).resolves.toBe(true);
    expect(preRoute).toHaveBeenCalledWith(message, 42);
  });
});
