import { describe, expect, it } from 'vitest';
import { hasAgentConfiguration } from '../../src/instance/start-command.js';

describe('start command Agent configuration boundary', () => {
  it('does not load the optional Agent Host for explicitly disabled sections', () => {
    expect(hasAgentConfiguration({ ai: { enabled: false } })).toBe(false);
    expect(hasAgentConfiguration({ ai: { enabled: true } })).toBe(true);
    expect(hasAgentConfiguration({ assistant: {} })).toBe(true);
  });

  it.each(['workroom', 'workrooms', 'remoteAgents', 'remote_mesh', 'remoteMesh'])(
    'rejects removed ai.%s before the disabled-Agent short circuit',
    (legacyKey) => {
      expect(() => hasAgentConfiguration({
        ai: { enabled: false, [legacyKey]: {} },
      })).toThrow(`ai.${legacyKey}`);
    },
  );
});
