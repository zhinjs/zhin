import {
  CONSOLE_BUILTIN_ROLES,
  CONSOLE_RPC_ALSO_REQUIRES,
  CONSOLE_RPC_PERMISSIONS,
  CONSOLE_WRITE_PERMISSIONS,
  ENV_MASK_CHAR,
  ENV_RPC,
  isConsoleEnvFileView,
  isConsoleEnvMaskPlaceholder,
  ENV_MASK_REVEAL_MIN_LENGTH,
  maskConsoleEnvValue,
  resolveConsoleRpcPermission,
} from '../src/index.js';

const MASK = ENV_MASK_CHAR.repeat(8);

describe('env RPC masking (issue #1250)', () => {
  it('masks every value: under 16 characters completely, longer ones keep 2 + 2 characters', () => {
    expect(ENV_MASK_REVEAL_MIN_LENGTH).toBe(16);
    expect(maskConsoleEnvValue('')).toBe('');
    expect(maskConsoleEnvValue('1')).toBe(MASK);
    expect(maskConsoleEnvValue('12345678')).toBe(MASK);
    expect(maskConsoleEnvValue('123456789')).toBe(MASK);
    expect(maskConsoleEnvValue('123456789012345')).toBe(MASK);
    expect(maskConsoleEnvValue('1234567890123456')).toBe(`12${MASK}56`);
    expect(maskConsoleEnvValue('sk-fake-0123456789abcdef')).toBe(`sk${MASK}ef`);
    // Characters, not UTF-16 units.
    expect(maskConsoleEnvValue('密钥密钥密钥密钥密钥')).toBe(MASK);
    expect(maskConsoleEnvValue('密钥'.repeat(8))).toBe(`密钥${MASK}密钥`);
    // The mask has a fixed width: it never tells the length.
    expect(maskConsoleEnvValue('a'.repeat(16)).length).toBe(maskConsoleEnvValue('a'.repeat(900)).length);
  });

  it('recognises mask placeholders, including the older Console mask, but not ordinary values', () => {
    for (const value of [MASK, `sk${MASK}ef`, '●', '●●', '"●●"', ' ●●●● ', 'prefix●●●suffix']) {
      expect(isConsoleEnvMaskPlaceholder(value)).toBe(true);
    }
    for (const value of ['', 'plain', 'a●b', '●a', '${TOKEN}']) {
      expect(isConsoleEnvMaskPlaceholder(value)).toBe(false);
    }
  });

  it('tells the masked env:get form from an older Host reply', () => {
    expect(isConsoleEnvFileView({ format: 'masked', file: '.env', variables: [], lines: [], content: '' })).toBe(true);
    expect(isConsoleEnvFileView({ content: 'TOKEN=raw' })).toBe(false);
    expect(isConsoleEnvFileView(null)).toBe(false);
  });

  it('registers env:reveal behind both env permissions; viewers and operators cannot reveal', () => {
    expect(CONSOLE_RPC_PERMISSIONS[ENV_RPC.REVEAL]).toBe('ops.env.write');
    expect(CONSOLE_WRITE_PERMISSIONS.has('ops.env.write')).toBe(true);
    expect(CONSOLE_RPC_ALSO_REQUIRES[ENV_RPC.REVEAL]).toEqual(['ops.env.read']);
    expect(resolveConsoleRpcPermission(ENV_RPC.REVEAL, { filename: '.env', key: 'K' }))
      .toEqual({ kind: 'exact', permission: 'ops.env.write', target: { kind: 'global' }, alsoRequires: ['ops.env.read'] });
    expect(resolveConsoleRpcPermission(ENV_RPC.GET)).toEqual({ kind: 'exact', permission: 'ops.env.read', target: { kind: 'global' } });
    for (const role of ['viewer', 'operator'] as const) {
      const held = CONSOLE_BUILTIN_ROLES[role].permissions;
      expect(held.includes('ops.env.write') && held.includes('ops.env.read')).toBe(false);
    }
  });
});
