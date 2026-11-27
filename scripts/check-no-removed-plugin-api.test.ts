import { describe, expect, it } from 'vitest';
import {
  allRuntimeRoots,
  codeLine,
  DESCRIBES_REMOVED_API,
  executableLine,
  findRemovedApiViolations,
  isExemptDetectorLine,
  pluginRoots,
  REMOVED_BOOTSTRAP_NODE,
  REMOVED_NODE_ENTRY_IMPORT,
  // @ts-expect-error plain .mjs script
} from './check-no-removed-plugin-api.mjs';
import { SELF_CHANGE_REMOVED_NODE_ENTRY_IMPORT } from '../packages/im/agent/src/self-change/trial.js';

/** A whole-repository scan, measured at a few seconds locally and slower under CI coverage. */
const REPO_SCAN_TIMEOUT_MS = 60_000;

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
    'const node = await import(`zhin.js/node`);',
    "const entry = require.resolve('zhin.js/node');",
    "const entry = import.meta.resolve('zhin.js/node/sub');",
  ])('flags the zhin.js/node import %s', (line) => {
    expect(REMOVED_NODE_ENTRY_IMPORT.test(codeLine(line))).toBe(true);
  });

  it('keeps the self-change trial copy of the zhin.js/node pattern identical (#1250 review M3)', () => {
    expect(SELF_CHANGE_REMOVED_NODE_ENTRY_IMPORT.source).toBe(REMOVED_NODE_ENTRY_IMPORT.source);
    expect(SELF_CHANGE_REMOVED_NODE_ENTRY_IMPORT.flags).toBe(REMOVED_NODE_ENTRY_IMPORT.flags);
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

  it('documents why each describing file is exempt and names the exempt lines', () => {
    for (const entry of Object.values(DESCRIBES_REMOVED_API) as Array<{ reason: string; lines: string[] }>) {
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.lines.length).toBeGreaterThan(0);
    }
  });

  it('exempts only the listed detector lines, not the whole file (#1250 review L4)', () => {
    const exemptions = { 'a/detector.ts': { reason: 'detects the removed API on purpose', lines: ['const RE = /bootstrapNode/u;'] } };
    const used = new Set<string>();
    expect(isExemptDetectorLine('a/detector.ts', 'const RE = /bootstrapNode/u;', used, exemptions)).toBe(true);
    expect(isExemptDetectorLine('a/detector.ts', 'await bootstrapNode({ cwd });', used, exemptions)).toBe(false);
    expect(isExemptDetectorLine('a/other.ts', 'const RE = /bootstrapNode/u;', used, exemptions)).toBe(false);
    expect([...used]).toEqual(['a/detector.ts\0const RE = /bootstrapNode/u;']);
  });

  // Scans every source file of the repository; under coverage instrumentation on CI runners one scan
  // takes several seconds, so this test scans once and gets a timeout sized for a whole-repo scan.
  it('passes on the repository', () => {
    expect(findRemovedApiViolations()).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);
});
