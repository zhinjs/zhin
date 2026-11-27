import { describe, expect, it } from 'vitest';
import {
  allRuntimeRoots,
  codeLine,
  DESCRIBES_REMOVED_API,
  executableLine,
  findRemovedApiViolations,
  pluginRoots,
  REMOVED_BOOTSTRAP_NODE,
  REMOVED_NODE_ENTRY_IMPORT,
  run,
  // @ts-expect-error plain .mjs script
} from './check-no-removed-plugin-api.mjs';

describe('check-no-removed-plugin-api', () => {
  it('scans every example, plugin and package source', () => {
    expect(pluginRoots).toEqual(['examples', 'plugins', 'packages']);
    expect(allRuntimeRoots).toEqual(['basic', 'examples', 'plugins', 'packages']);
  });

  it.each([
    "import { bootstrapNode } from 'zhin.js/node';",
    'import "zhin.js/node";',
    "const node = await import('zhin.js/node');",
    "const node = require(\"zhin.js/node\");",
    "export * from 'zhin.js/node';",
    "import { x } from 'zhin.js/node/sub';",
  ])('flags the zhin.js/node import %s', (line) => {
    expect(REMOVED_NODE_ENTRY_IMPORT.test(codeLine(line))).toBe(true);
  });

  it.each([
    'await bootstrapNode({ cwd })',
    'export { bootstrapNode };',
    'const start = bootstrapNode;',
  ])('flags the bootstrapNode reference %s', (line) => {
    expect(REMOVED_BOOTSTRAP_NODE.test(executableLine(line))).toBe(true);
  });

  it.each([
    "// import { bootstrapNode } from 'zhin.js/node';",
    " * `zhin.js/node` was removed; see bootstrapNode migration",
    "import { definePlugin } from 'zhin.js';",
    "import { x } from 'zhin.js/nodes';",
    "const removed = ['bootstrapNode'];",
  ])('ignores %s', (line) => {
    expect(REMOVED_NODE_ENTRY_IMPORT.test(codeLine(line))).toBe(false);
    expect(REMOVED_BOOTSTRAP_NODE.test(executableLine(line))).toBe(false);
  });

  it('documents why each describing file is exempt', () => {
    for (const reason of Object.values(DESCRIBES_REMOVED_API)) expect(String(reason).length).toBeGreaterThan(20);
  });

  it('passes on the repository', () => {
    expect(findRemovedApiViolations()).toEqual([]);
    expect(run()).toBe(0);
  });
});
