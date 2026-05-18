import { describe, it, expect } from 'vitest';
import { resolveConfigEnvString } from '../src/utils/config-env.js';

describe('resolveConfigEnvString', () => {
  it('整串 ${VAR}', () => {
    expect(resolveConfigEnvString('${FOO}', { FOO: 'bar' })).toBe('bar');
  });

  it('字符串内嵌 ${VAR}', () => {
    expect(
      resolveConfigEnvString('Bearer ${TOKEN}', { TOKEN: 'Lcl9623.' }),
    ).toBe('Bearer Lcl9623.');
  });
});
