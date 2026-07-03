import { describe, it, expect } from 'vitest';
import { validateEndpointConfigName } from '../src/setup/connect-endpoints.js';

describe('validateEndpointConfigName', () => {
  it('rejects empty name', () => {
    expect(validateEndpointConfigName({ name: '' })).toMatch(/为空/);
  });

  it('rejects unresolved env placeholder', () => {
    expect(validateEndpointConfigName({ name: '${ICQQ_ACCOUNT_5}' })).toMatch(/未解析/);
  });

  it('accepts resolved qq number', () => {
    expect(validateEndpointConfigName({ name: '717505091' })).toBeNull();
  });
});
