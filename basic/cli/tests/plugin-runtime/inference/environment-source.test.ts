import { resolveHostCredentialSource } from '@zhin.js/plugin-runtime';

it('uses the trusted environment lookup for legacy references and one private default expression', () => {
  const lookup = vi.fn((key: string) => key === 'PRESENT' ? 'synthetic-environment-key' : key === 'EMPTY' ? '' : undefined);
  expect(resolveHostCredentialSource('env://PRESENT', lookup)).toBe('synthetic-environment-key');
  for (const operator of [':-', ':=']) {
    for (const variable of ['MISSING', 'EMPTY']) {
      expect(resolveHostCredentialSource({ kind: 'environment-expression', expression: `\${${variable}${operator}synthetic-default}` }, lookup)).toBe('synthetic-default');
    }
    expect(resolveHostCredentialSource({ kind: 'environment-expression', expression: `\${PRESENT${operator}unused}` }, lookup)).toBe('synthetic-environment-key');
  }
  expect(resolveHostCredentialSource('invalid://PRESENT', lookup)).toBeUndefined();
});
