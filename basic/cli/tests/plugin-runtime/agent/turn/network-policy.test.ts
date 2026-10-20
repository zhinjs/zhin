import { describe, expect, it } from 'vitest';
import { interactiveNetworkPolicy } from '../../../../src/plugin-runtime/agent/turn/request.js';

type Config = Parameters<typeof interactiveNetworkPolicy>[0];
const policy = (config: Record<string, unknown>) => interactiveNetworkPolicy(config as Config);

describe('interactiveNetworkPolicy', () => {
  it('keeps network off by default', () => {
    expect(policy({})).toBeUndefined();
    expect(interactiveNetworkPolicy(undefined as Config)).toBeUndefined();
  });

  it('enables HTTPS egress with ai.agent.network.enabled and trims allowed domains', () => {
    expect(policy({ network: { enabled: true, allowedDomains: [' github.com ', ''] } })).toEqual({
      enabled: true,
      httpsOnly: true,
      allowedDomains: ['github.com'],
    });
  });

  it('still honours the legacy execPreset: network when network.enabled is unset', () => {
    expect(policy({ execPreset: 'network' })).toEqual({ enabled: true, httpsOnly: true, allowedDomains: [] });
  });

  it('lets an explicit network.enabled: false win over the legacy preset', () => {
    expect(policy({ execPreset: 'network', network: { enabled: false } })).toBeUndefined();
  });
});
