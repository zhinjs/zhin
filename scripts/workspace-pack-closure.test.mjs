import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveWorkspacePackClosure,
  withWorkspaceTarballOverrides,
} from './workspace-pack-closure.mjs';

test('resolves the full unpublished workspace dependency closure', () => {
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

  assert.deepEqual(
    new Set(closure.map(({ name }) => name)),
    new Set([
      '@example/client',
      '@example/contract',
      '@example/protocol',
      '@example/runtime',
    ]),
  );
  assert.ok(
    closure.findIndex(({ name }) => name === '@example/contract')
      < closure.findIndex(({ name }) => name === '@example/client'),
  );
});

test('overrides the full workspace closure with packed tarballs', () => {
  const manifest = {
    name: '@example/console',
    pnpm: {
      onlyBuiltDependencies: ['esbuild'],
      overrides: { external: '1.2.3' },
    },
  };
  const closure = [
    { name: '@example/contract' },
    { name: '@example/client' },
  ];
  const packedPackages = new Map([
    ['@example/contract', { tarball: '/tmp/example-contract.tgz' }],
    ['@example/client', { tarball: '/tmp/example-client.tgz' }],
  ]);

  assert.deepEqual(
    withWorkspaceTarballOverrides(manifest, closure, packedPackages),
    {
      ...manifest,
      pnpm: {
        onlyBuiltDependencies: ['esbuild'],
        overrides: {
          external: '1.2.3',
          '@example/contract': 'file:/tmp/example-contract.tgz',
          '@example/client': 'file:/tmp/example-client.tgz',
        },
      },
    },
  );
  assert.deepEqual(manifest.pnpm.overrides, { external: '1.2.3' });
});

test('rejects an incomplete set of packed workspace artifacts', () => {
  assert.throws(
    () => withWorkspaceTarballOverrides(
      {},
      [{ name: '@example/client' }],
      new Map(),
    ),
    /Packed workspace artifact is missing: @example\/client/u,
  );
});
