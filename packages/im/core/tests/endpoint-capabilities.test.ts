import { describe, it, expect } from 'vitest';
import { Plugin } from '../src/plugin.js';
import { Adapter } from '../src/adapter.js';
import type { OutboundEndpoint } from '../src/endpoint-capabilities.js';
import {
  resolveEndpointCapabilities,
  registerEndpointCapabilities,
  hasInbound,
  hasOutbound,
  assertInbound,
  assertOutbound,
  InboundNotSupportedError,
  OutboundNotSupportedError,
  type InboundEndpoint,
} from '../src/endpoint-capabilities.js';
import { connectEndpointInstance } from '../src/built/connect-endpoint-instance.js';

describe('endpoint-capabilities', () => {
  it('resolveEndpointCapabilities 默认继承 adapter 上限', () => {
    expect(resolveEndpointCapabilities(['inbound', 'outbound'])).toEqual(['inbound', 'outbound']);
  });

  it('resolveEndpointCapabilities 允许 bot 缩减子集', () => {
    expect(resolveEndpointCapabilities(['inbound', 'outbound'], ['inbound'])).toEqual(['inbound']);
  });

  it('resolveEndpointCapabilities 超出 adapter 上限时抛错', () => {
    expect(() => resolveEndpointCapabilities(['inbound'], ['outbound'])).toThrow(/exceeds adapter/);
  });

  it('hasInbound/hasOutbound 读取注册表', () => {
    const bot = { $id: 'b1', $config: {} };
    registerEndpointCapabilities(bot, ['inbound']);
    expect(hasInbound(bot)).toBe(true);
    expect(hasOutbound(bot)).toBe(false);
  });

  it('connectEndpointInstance 对 outbound-only 跳过 $connect', async () => {
    class OutOnlyEndpoint implements OutboundEndpoint {
      $id = 'out-only';
      $config = { name: 'out-only', capabilities: ['outbound'] as const };
      $connected = false;
      async $sendMessage() {
        return 'ok';
      }
      async $recallMessage() {}
    }

    class OutOnlyAdapter extends Adapter<OutOnlyEndpoint> {
      static override readonly capabilities = ['outbound'] as const;
      createEndpoint() {
        return new OutOnlyEndpoint();
      }
    }

    const plugin = new Plugin('/test/out-only.ts');
    const adapter = new OutOnlyAdapter(plugin, 'process' as never, []);
    const bot = await connectEndpointInstance({
      plugin,
      adapter,
      config: { name: 'out-only', capabilities: ['outbound'] },
    });

    expect(bot.$connected).toBe(true);
    expect(hasInbound(bot)).toBe(false);
    expect(hasOutbound(bot)).toBe(true);
    expect('$connect' in bot).toBe(false);
  });

  it('assertInbound/assertOutbound 守卫', () => {
    const inboundOnly = { $id: 'in' } as InboundEndpoint;
    registerEndpointCapabilities(inboundOnly, ['inbound']);
    expect(() => assertOutbound(inboundOnly as InboundEndpoint & OutboundEndpoint)).toThrow(
      OutboundNotSupportedError,
    );

    const outboundOnly = { $id: 'out' } as OutboundEndpoint;
    registerEndpointCapabilities(outboundOnly, ['outbound']);
    expect(() => assertInbound(outboundOnly as InboundEndpoint & OutboundEndpoint)).toThrow(
      InboundNotSupportedError,
    );
  });
});
