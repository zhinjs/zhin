import { describe, expect, it } from 'vitest';
import {
  resolveEndpointAtIds,
  resolveEndpointAiAccess,
  resolveEndpointConfig,
} from '../../src/collaboration/inbound-turn-endpoint.js';

describe('inbound-turn-endpoint', () => {
  const message = {
    $adapter: 'mock',
    $endpoint: 'ep-main',
  } as any;

  it('resolveEndpointConfig returns undefined when inject throws', () => {
    const root = { inject: () => { throw new Error('no adapter'); } } as any;
    expect(resolveEndpointConfig(message, root)).toBeUndefined();
  });

  it('resolveEndpointAtIds collects endpoint id and config aliases', () => {
    const root = {
      inject: () => ({
        endpoints: new Map([
          ['ep-main', {
            $platformUserId: 'plat-1',
            $config: { name: 'bot-a', appid: 'app-9' },
          }],
        ]),
      }),
    } as any;

    expect(resolveEndpointAtIds(message, root).sort()).toEqual(
      ['app-9', 'bot-a', 'ep-main', 'plat-1'].sort(),
    );
  });

  it('resolveEndpointAiAccess reads aiAccess from shared lookup', () => {
    const aiAccess = { mode: 'whitelist' as const, users: ['u1'] };
    const root = {
      inject: () => ({
        endpoints: new Map([['ep-main', { $config: { aiAccess } }]]),
      }),
    } as any;

    expect(resolveEndpointAiAccess(message, root)).toBe(aiAccess);
  });
});
