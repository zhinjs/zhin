import { describe, expect, it } from 'vitest';
import {
  NETWORK_DISABLED_PROMPT_NOTE,
  NETWORK_DISABLED_REASON,
  turnPolicyAllowsNetwork,
  withoutForbiddenNetwork,
} from '../../src/security/network-authority.js';

const tools = [{ name: 'web_fetch' }, { name: 'web_search' }, { name: 'read_file' }];

describe('network authority', () => {
  it('allows network only when the policy explicitly enables it', () => {
    expect(turnPolicyAllowsNetwork(undefined)).toBe(false);
    expect(turnPolicyAllowsNetwork({})).toBe(false);
    expect(turnPolicyAllowsNetwork({ network: { enabled: false } })).toBe(false);
    expect(turnPolicyAllowsNetwork({ network: { enabled: true } })).toBe(true);
  });

  it('withholds web tools without network authority and keeps them with it', () => {
    expect(withoutForbiddenNetwork({}, tools).map(tool => tool.name)).toEqual(['read_file']);
    expect(withoutForbiddenNetwork({ network: { enabled: true } }, tools)).toEqual(tools);
  });

  it('tells the model and the user the real switch instead of leaving them to guess', () => {
    expect(NETWORK_DISABLED_REASON).toContain('no network authority');
    for (const text of [NETWORK_DISABLED_REASON, NETWORK_DISABLED_PROMPT_NOTE]) {
      expect(text).toContain('zhin.config.yml');
      expect(text).toContain('ai.agent.network.enabled: true');
    }
  });
});
