import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkspacePackClosure } from './workspace-pack-closure.mjs';

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
