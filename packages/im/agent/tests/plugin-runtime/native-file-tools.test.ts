import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCapabilitySlot,
  rootPluginId,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { ToolIndex } from '@zhin.js/tool';
import { createNativeFileToolFeatures } from '../../src/plugin-runtime/native-file-tools.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('native file ToolFeatures', () => {
  it('executes read/list/glob/grep through ToolIndex with one explicit workspace context', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zhin-native-files-'));
    temporaryRoots.push(workspace);
    await mkdir(join(workspace, 'src'));
    await writeFile(join(workspace, 'src', 'answer.ts'), 'export const answer = 42;\n');
    const index = createIndex();
    const invocation = createInvocation(workspace);

    await expect(index.execute({ requester: rootPluginId(), name: 'read_file', input: {
      file_path: join(workspace, 'src', 'answer.ts'),
    }, invocation: invocation })).resolves.toContain('export const answer = 42');
    await expect(index.execute({ requester: rootPluginId(), name: 'list_dir', input: {
      path: join(workspace, 'src'),
    }, invocation: invocation })).resolves.toContain('answer.ts');
    await expect(index.execute({ requester: rootPluginId(), name: 'glob', input: {
      cwd: workspace,
      pattern: '**/*.ts',
    }, invocation: invocation })).resolves.toContain('src/answer.ts');
    await expect(index.execute({ requester: rootPluginId(), name: 'grep', input: {
      path: workspace,
      pattern: 'answer = 42',
    }, invocation: invocation })).resolves.toContain('src/answer.ts:1');
    await expect(index.execute({ requester: rootPluginId(), name: 'edit_file', input: {
      file_path: join(workspace, 'src', 'answer.ts'),
      old_string: 'answer = 42',
      new_string: 'answer = 43',
    }, invocation: invocation })).resolves.toContain('Edited');
    await expect(readFile(join(workspace, 'src', 'answer.ts'), 'utf8'))
      .resolves.toContain('answer = 43');
    await expect(index.execute({ requester: rootPluginId(), name: 'write_file', input: {
      file_path: join(workspace, 'src', 'created.ts'),
      content: 'export const created = true;\n',
    }, invocation: invocation })).resolves.toContain('Wrote 29 bytes');
    await expect(readFile(join(workspace, 'src', 'created.ts'), 'utf8'))
      .resolves.toBe('export const created = true;\n');
  });

  it('skips dependency, VCS, state and gitignored trees unless the path targets them', async () => {
    const workspace = await tempWorkspace();
    await writeFiles(workspace, {
      '.gitignore': '/lib/\n*.log\n!keep.log\n',
      'package.json': '{"name":"app"}\n',
      'src/lib/util.ts': 'export const needle = 1;\n',
      'lib/out.js': 'needle\n',
      'debug.log': 'needle\n',
      'keep.log': 'needle\n',
      'node_modules/dep/package.json': '{"name":"dep","needle":true}\n',
      '.opencode/node_modules/x/package.json': '{"needle":true}\n',
      '.git/config': 'needle\n',
      '.zhin/state.json': 'needle\n',
      'dist/index.js': 'needle\n',
      'coverage/lcov.info': 'needle\n',
    });
    const index = createIndex();
    const invocation = createInvocation(workspace);

    const all = await index.execute({ requester: rootPluginId(), name: 'grep', input: { path: workspace, pattern: 'needle' }, invocation: invocation });
    expect(String(all).split('\n').map((line) => line.split(':')[0]).sort()).toEqual(['keep.log', 'src/lib/util.ts']);

    const manifests = await index.execute({ requester: rootPluginId(), name: 'glob', input: { cwd: workspace, pattern: '**/package.json' }, invocation: invocation });
    expect(manifests).toBe('Found 1 files:\npackage.json');

    await expect(index.execute({ requester: rootPluginId(), name: 'grep', input: {
      path: join(workspace, 'node_modules', 'dep'),
      pattern: 'needle',
    }, invocation: invocation })).resolves.toContain('package.json:1');
    await expect(index.execute({ requester: rootPluginId(), name: 'glob', input: {
      cwd: join(workspace, 'lib'),
      pattern: '*.js',
    }, invocation: invocation })).resolves.toContain('out.js');
  });

  it('honours an ancestor .gitignore when searching a sub-directory', async () => {
    const workspace = await tempWorkspace();
    await writeFiles(workspace, {
      '.gitignore': 'generated/\n',
      'pkg/generated/a.ts': 'needle\n',
      'pkg/src/b.ts': 'needle\n',
    });
    await expect(createIndex().execute({ requester: rootPluginId(), name: 'grep', input: {
      path: join(workspace, 'pkg'),
      pattern: 'needle',
    }, invocation: createInvocation(workspace) })).resolves.toBe('src/b.ts:1:needle');
  });

  it.each(['.*', '^', '$', 'x*', '(?:)'])('rejects the match-everything grep pattern %j with guidance', async (pattern) => {
    const workspace = await tempWorkspace();
    await writeFiles(workspace, { 'package.json': '{}\n' });
    await expect(createIndex().execute({ requester: rootPluginId(), name: 'grep', input: {
      path: workspace,
      pattern,
      include: 'package.json',
    }, invocation: createInvocation(workspace) })).rejects.toThrow(/matches every line.*read_file.*glob or list_dir/);
  });

  it('caps grep matches and output size with a narrowing notice', async () => {
    const workspace = await tempWorkspace();
    await writeFiles(workspace, {
      'many.txt': Array.from({ length: 500 }, (_, index) => `hit ${index}`).join('\n'),
      'wide.txt': Array.from({ length: 150 }, () => `hit ${'x'.repeat(1_000)}`).join('\n'),
    });
    const index = createIndex();
    const invocation = createInvocation(workspace);

    const capped = String(await index.execute({ requester: rootPluginId(), name: 'grep', input: {
      path: join(workspace, 'many.txt'),
      pattern: 'hit',
      limit: 10_000,
    }, invocation: invocation }));
    expect(capped.split('\n')).toHaveLength(201);
    expect(capped).toMatch(/\[truncated at 200 matches; narrow the pattern/);

    const wide = String(await index.execute({ requester: rootPluginId(), name: 'grep', input: {
      path: join(workspace, 'wide.txt'),
      pattern: 'hit',
      limit: 200,
    }, invocation: invocation }));
    expect(Buffer.byteLength(wide)).toBeLessThan(26 * 1024);
    expect(wide).toContain('[line truncated, 1004 chars]');
    expect(wide).toMatch(/\[truncated at 24576 bytes; narrow the pattern/);
  });

  it('skips binary files while grepping', async () => {
    const workspace = await tempWorkspace();
    await writeFile(join(workspace, 'blob.bin'), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00, 0x01]));
    await writeFiles(workspace, { 'text.txt': 'needle\n' });
    await expect(createIndex().execute({ requester: rootPluginId(), name: 'grep', input: {
      path: workspace,
      pattern: 'needle',
    }, invocation: createInvocation(workspace) })).resolves.toBe('text.txt:1:needle');
  });

  it('caps glob, list_dir and read_file output with continuation hints', async () => {
    const workspace = await tempWorkspace();
    const files: Record<string, string> = {};
    for (let index = 0; index < 520; index += 1) files[`d/f${String(index).padStart(3, '0')}.ts`] = '';
    files['big.txt'] = Array.from({ length: 2_500 }, (_, index) => `line ${index}`).join('\n');
    await writeFiles(workspace, files);
    const index = createIndex();
    const invocation = createInvocation(workspace);

    await expect(index.execute({ requester: rootPluginId(), name: 'glob', input: { cwd: workspace, pattern: 'd/*.ts' }, invocation: invocation }))
      .resolves.toMatch(/Found 100 files:[\s\S]*\[truncated at 100 files; narrow the pattern/);
    await expect(index.execute({ requester: rootPluginId(), name: 'list_dir', input: { path: join(workspace, 'd') }, invocation: invocation }))
      .resolves.toMatch(/\[truncated: showing 500 of 520 entries/);
    const read = String(await index.execute({ requester: rootPluginId(), name: 'read_file', input: {
      file_path: join(workspace, 'big.txt'),
    }, invocation: invocation }));
    expect(read).toContain('(2500 lines, showing 1-2000)');
    expect(read).toContain('[500 more lines; call read_file again with offset=2000 to continue]');
  });

  it('honors cancellation before filesystem I/O', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zhin-native-files-'));
    temporaryRoots.push(workspace);
    const controller = new AbortController();
    controller.abort('turn ended');
    const index = createIndex();

    await expect(index.execute({ requester: rootPluginId(), name: 'read_file', input: {
      file_path: join(workspace, 'missing.txt'),
    }, invocation: createInvocation(workspace, controller.signal) })).rejects.toBe('turn ended');
  });
});

function createIndex(): ToolIndex {
  const root = rootPluginId();
  const slots = createNativeFileToolFeatures().map((tool) => createCapabilitySlot({
    owner: root,
    feature: tool.feature,
    localName: tool.name,
    source: `/builtin/${tool.name}`,
    definition: tool.definition,
  }));
  return new ToolIndex(slots, createSnapshot(slots));
}

function createInvocation(workspaceRoot: string, signal = new AbortController().signal) {
  return {
    signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'session',
    origin: { kind: 'http', sessionId: 'session' },
    principal: { subjectId: 'owner', roles: ['owner'] },
    policy: {
      permissions: ['owner'],
      unattended: false,
      network: { enabled: false },
      filesystem: { workspaceRoot },
    },
  } as const;
}

function createSnapshot(
  slots: readonly ReturnType<typeof createCapabilitySlot>[],
): RuntimeSnapshot {
  const root = rootPluginId();
  return {
    generation: 1,
    root,
    tree: new Map([[root, {
      id: root,
      instanceKey: 'root',
      packageName: '@test/root',
      packageRoot: '/project',
      children: [],
    }]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, new Map()]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  };
}

async function tempWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'zhin-native-files-'));
  temporaryRoots.push(workspace);
  return workspace;
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, relative)), { recursive: true });
    await writeFile(join(root, relative), content);
  }
}
