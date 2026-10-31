import { CommandIndex, commandFeatureId, type CommandDefinition } from 'zhin.js/command';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from 'zhin.js/plugin-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.js';
import runCommand from '../commands/run/[language]/index.js';
import { formatResult } from '../src/run-code.js';

describe('@zhin.js/plugin-code-runner', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('code-runner');
  });

  it('brands run command', () => {
    expect(parseCommandDefinition(runCommand)).toBe(runCommand);
  });

  it('formats empty run result', () => {
    expect(formatResult({ stdout: '', stderr: '', error: '' })).toBe('（无输出）');
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('rejects unsupported language through the parser without network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const index = commandIndex('run/$language', { ...runCommand, $parameter: { name: 'language', type: 'string' } });
    await expect(index.dispatch({ input: 'run brainfuck ++' })).resolves.toMatchObject({ status: 'invalid', issues: [{ field: 'language' }] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves code quotes and forwards declared timeout through real parsing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stdout: 'hello', stderr: '', error: '' }) });
    vi.stubGlobal('fetch', fetchMock);
    const index = commandIndex('run/$language', { ...runCommand, $parameter: { name: 'language', type: 'string' } });
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const result = await index.dispatch({ input: 'run javascript --timeout 5 console.log("hello")' });
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(result).toMatchObject({ status: 'executed', value: '[stdout]\nhello' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ files: [{ name: 'main.js', content: 'console.log("hello")' }] });
    await expect(index.dispatch({ input: 'run python --timeout 31 print(1)' })).resolves.toMatchObject({ status: 'invalid' });
    await expect(index.dispatch({ input: 'run javascript' })).resolves.toMatchObject({ status: 'invalid', issues: [{ field: 'code' }] });
  });

  it.each(['JavaScript', 'PYTHON'])('validates normalized language %s before sending the request', async (language) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stdout: 'ok', stderr: '', error: '' }) });
    vi.stubGlobal('fetch', fetchMock);
    const index = commandIndex('run/$language', { ...runCommand, $parameter: { name: 'language', type: 'string' } });
    await expect(index.dispatch({ input: `run ${language} print(1)` })).resolves.toMatchObject({ status: 'executed' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/${language.toLowerCase()}/latest`);
  });
});

function commandIndex(localName: string, definition: CommandDefinition) {
  const owner = rootPluginId();
  const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName, source: `/commands/${localName}/index.ts`, definition });
  const snapshot = { generation: 1, root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@test/plugin', packageRoot: '/test', children: [] }]]),
    config: new Map([[owner, {}]]), resources: new Map([[owner, new Map()]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  } satisfies RuntimeSnapshot;
  return new CommandIndex([slot], snapshot);
}
