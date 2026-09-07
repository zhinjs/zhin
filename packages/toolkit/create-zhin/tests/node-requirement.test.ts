import { describe, expect, it } from 'vitest';
import { assertCreateNodeVersion } from '../src/node-requirement.js';

describe('scaffold native TypeScript environment', () => {
  it.each(['20.19.0', '21.7.0', '22.6.0', '22.11.9', 'invalid'])('rejects %s before project creation', (version) => {
    expect(() => assertCreateNodeVersion(version)).toThrow('requires Node.js >=22.12.0');
  });
  it.each(['22.12.0', '22.20.0', '24.0.0', '26.0.0'])('accepts %s', (version) => {
    expect(() => assertCreateNodeVersion(version)).not.toThrow();
  });
});
