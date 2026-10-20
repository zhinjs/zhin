import { describe, expect, it } from 'vitest';
import {
  resolveWorkspacePackClosure,
  withWorkspaceTarballOverrides,
} from './workspace-pack-closure.mjs';

describe('workspace pack closure', () => {
  it('resolves the full unpublished workspace dependency closure', () => {
    const packages = [
      {
        name: '@example/client',
        manifest: {
          dependencies: {
            '@example/contract': 'workspace:*',
            external: '^1.0.0',
          },
        },
      },
      {
        name: '@example/contract',
        manifest: {
          dependencies: { '@example/protocol': 'workspace:^' },
          peerDependencies: { '@example/runtime': 'workspace:*' },
        },
      },
      { name: '@example/protocol', manifest: {} },
      { name: '@example/runtime', manifest: {} },
      { name: '@example/unrelated', manifest: {} },
    ];

    const closure = resolveWorkspacePackClosure(packages, [
      '@example/protocol',
      '@example/client',
    ]);
    const names = closure.map(({ name }) => name);

    expect(new Set(names)).toEqual(new Set([
      '@example/client',
      '@example/contract',
      '@example/protocol',
      '@example/runtime',
    ]));
    expect(names.indexOf('@example/contract'))
      .toBeLessThan(names.indexOf('@example/client'));
  });

  it('rejects a missing workspace root', () => {
    expect(() => resolveWorkspacePackClosure([], ['@example/missing']))
      .toThrow('Workspace package not found: @example/missing');
  });
});

describe('workspace tarball overrides', () => {
  it('merges packed artifacts into existing pnpm overrides', () => {
    const manifest = {
      name: '@example/console',
      pnpm: {
        onlyBuiltDependencies: ['esbuild'],
        overrides: { external: '1.2.3' },
      },
    };
    const result = withWorkspaceTarballOverrides(
      manifest,
      [
        { name: '@example/contract' },
        { name: '@example/client' },
      ],
      new Map([
        ['@example/contract', { tarball: '/tmp/example-contract.tgz' }],
        ['@example/client', { tarball: '/tmp/example-client.tgz' }],
      ]),
    );

    expect(result).toEqual({
      ...manifest,
      pnpm: {
        onlyBuiltDependencies: ['esbuild'],
        overrides: {
          external: '1.2.3',
          '@example/contract': 'file:/tmp/example-contract.tgz',
          '@example/client': 'file:/tmp/example-client.tgz',
        },
      },
    });
    expect(manifest.pnpm.overrides).toEqual({ external: '1.2.3' });
  });

  it('creates pnpm configuration when the consumer has none', () => {
    expect(withWorkspaceTarballOverrides(
      { name: '@example/console' },
      [{ name: '@example/client' }],
      new Map([
        ['@example/client', { tarball: '/tmp/example-client.tgz' }],
      ]),
    )).toEqual({
      name: '@example/console',
      pnpm: {
        overrides: {
          '@example/client': 'file:/tmp/example-client.tgz',
        },
      },
    });
  });

  it('rejects an incomplete packed artifact set', () => {
    expect(() => withWorkspaceTarballOverrides(
      {},
      [{ name: '@example/client' }],
      new Map(),
    )).toThrow('Packed workspace artifact is missing: @example/client');
  });
});
