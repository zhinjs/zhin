import { describe, expect, it } from 'vitest';
import { isNodeVersionSupported } from '../src/utils/node-requirements.js';

describe('node-requirements', () => {
  it('accepts Node 22.19+', () => {
    expect(isNodeVersionSupported('v22.19.0')).toBe(true);
    expect(isNodeVersionSupported('v24.0.0')).toBe(true);
    expect(isNodeVersionSupported('v26.0.0')).toBe(true);
  });

  it('rejects outdated Node versions', () => {
    expect(isNodeVersionSupported('v18.20.0')).toBe(false);
    expect(isNodeVersionSupported('v20.18.0')).toBe(false);
    expect(isNodeVersionSupported('v20.19.0')).toBe(false);
    expect(isNodeVersionSupported('v22.11.0')).toBe(false);
    expect(isNodeVersionSupported('v22.18.0')).toBe(false);
  });
});
