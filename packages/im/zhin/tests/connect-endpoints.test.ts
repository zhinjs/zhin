import { describe, it, expect } from 'vitest';
import { validateEndpointConfigId } from '../src/setup/connect-endpoints.js';

describe('validateEndpointConfigId', () => {
  it('rejects empty id', () => {
    expect(validateEndpointConfigId({ id: '' })).toMatch(/为空/);
  });

  it('rejects unresolved env placeholder', () => {
    expect(validateEndpointConfigId({ id: '${ICQQ_ACCOUNT_5}' })).toMatch(/未解析/);
  });

  it('accepts resolved qq number', () => {
    expect(validateEndpointConfigId({ id: '717505091' })).toBeNull();
  });
});
