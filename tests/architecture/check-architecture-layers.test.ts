import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractBarePackageName,
  findUndeclaredWorkspaceImports,
  layers,
  packageNameToPath,
} from '../../scripts/check-architecture-layers.mjs';
import {
  findAgentManifestWorkroomViolations,
  findAgentWorkroomViolations,
} from '../../scripts/lib/agent-workroom-boundary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, '../../scripts/check-architecture-layers.mjs');

describe('check-architecture-layers (ADR 0048 H5)', () => {
  it('registers @zhin.js/harness between core/kernel/im-contract and agent and removes @zhin.js/workroom', () => {
    expect(packageNameToPath['@zhin.js/harness']).toBe('packages/im/harness');
    expect((packageNameToPath as Record<string, string>)['@zhin.js/workroom']).toBeUndefined();
    expect((layers as Record<string, unknown>)['packages/im/workroom']).toBeUndefined();

    const harnessLayer = layers['packages/im/harness'];
    expect(harnessLayer).toBeDefined();
    expect(harnessLayer.allowedImports).toEqual(
      expect.arrayContaining(['basic', 'packages/im/im-contract', 'packages/im/kernel', 'packages/im/core']),
    );
    expect(harnessLayer.allowedImports).not.toContain('packages/im/agent');

    expect(layers['packages/im/core'].allowedImports).toContain('packages/im/harness');
    expect(layers['packages/im/agent'].allowedImports).toContain('packages/im/harness');
    expect(layers['packages/host/a2a'].allowedImports).toContain('packages/im/harness');
    expect(layers['packages/host/a2a'].allowedImports).not.toContain('packages/im/workroom');
  });

  it('rejects any residual workroom imports or manifest dependencies in @zhin.js/agent', () => {
    expect(
      findAgentWorkroomViolations({
        file: 'packages/im/agent/src/index.ts',
        content: `import { x } from '@zhin.js/workroom';`,
      }),
    ).toHaveLength(1);
    expect(
      findAgentManifestWorkroomViolations(
        { dependencies: { '@zhin.js/workroom': 'workspace:*' } },
        'packages/im/agent/package.json',
      ),
    ).toHaveLength(1);
  });

  it('extracts bare package names and detects undeclared workspace imports', () => {
    expect(extractBarePackageName('@zhin.js/harness')).toBe('@zhin.js/harness');
    const violations = findUndeclaredWorkspaceImports({
      file: 'packages/im/agent/src/index.ts',
      content: `import { createHarness } from '@zhin.js/harness';`,
      manifest: { name: '@zhin.js/agent', dependencies: {} },
      manifestPath: 'packages/im/agent/package.json',
      workspacePackageNames: new Set(['@zhin.js/harness']),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.packageName).toBe('@zhin.js/harness');
  });

  it('passes against the repository', () => {
    const out = execFileSync('node', [scriptPath], { encoding: 'utf8' });
    expect(out).toContain('Harness architecture layer check: OK (no layer violations found).');
    expect(out).toContain('Harness undeclared workspace dependency check: OK.');
  }, 60_000);
});
