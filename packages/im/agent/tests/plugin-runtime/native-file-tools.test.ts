import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

    await expect(index.execute(rootPluginId(), 'read_file', {
      file_path: join(workspace, 'src', 'answer.ts'),
    }, invocation)).resolves.toContain('export const answer = 42');
    await expect(index.execute(rootPluginId(), 'list_dir', {
      path: join(workspace, 'src'),
    }, invocation)).resolves.toContain('answer.ts');
    await expect(index.execute(rootPluginId(), 'glob', {
      cwd: workspace,
      pattern: '**/*.ts',
    }, invocation)).resolves.toContain('src/answer.ts');
    await expect(index.execute(rootPluginId(), 'grep', {
      path: workspace,
      pattern: 'answer = 42',
    }, invocation)).resolves.toContain('src/answer.ts:1');
    await expect(index.execute(rootPluginId(), 'edit_file', {
      file_path: join(workspace, 'src', 'answer.ts'),
      old_string: 'answer = 42',
      new_string: 'answer = 43',
    }, invocation)).resolves.toContain('Edited');
    await expect(readFile(join(workspace, 'src', 'answer.ts'), 'utf8'))
      .resolves.toContain('answer = 43');
    await expect(index.execute(rootPluginId(), 'write_file', {
      file_path: join(workspace, 'src', 'created.ts'),
      content: 'export const created = true;\n',
    }, invocation)).resolves.toContain('Wrote 29 bytes');
    await expect(readFile(join(workspace, 'src', 'created.ts'), 'utf8'))
      .resolves.toBe('export const created = true;\n');
  });

  it('honors cancellation before filesystem I/O', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'zhin-native-files-'));
    temporaryRoots.push(workspace);
    const controller = new AbortController();
    controller.abort('turn ended');
    const index = createIndex();

    await expect(index.execute(rootPluginId(), 'read_file', {
      file_path: join(workspace, 'missing.txt'),
    }, createInvocation(workspace, controller.signal))).rejects.toBe('turn ended');
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
    principal: { subjectId: 'owner', roles: ['master'] },
    policy: {
      permissions: ['master'],
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
