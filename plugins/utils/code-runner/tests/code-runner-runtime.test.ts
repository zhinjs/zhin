import { CommandIndex, commandFeatureId, type CommandDefinition } from 'zhin.js/command';
import { createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from 'zhin.js/plugin-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from 'zhin.js/command';
import plugin from '../plugin.js';
import runCommand from '../commands/run/[language]/index.js';
import { formatResult, normalizeLanguage, runCode } from '../src/run-code.js';
import { resolveCodeRunnerBackend } from '../src/config.js';
import runCodeTool from '../skills/code-runner/tools/run_code/index.js';

const glotConfig = { provider: 'glot', endpoint: 'https://runner.example/api/run', token: 'secret-token' };
const pistonConfig = { provider: 'piston', endpoint: 'http://127.0.0.1:2000/api/v2/execute' };

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
    const index = commandIndex('run/$language', { ...runCommand, $parameter: { name: 'language', type: 'string' } }, glotConfig);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const result = await index.dispatch({ input: 'run javascript --timeout 5 console.log("hello")' });
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(result).toMatchObject({ status: 'executed', value: '[stdout]\nhello' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://runner.example/api/run/javascript/latest');
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Token secret-token' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ files: [{ name: 'main.js', content: 'console.log("hello")' }] });
    await expect(index.dispatch({ input: 'run python --timeout 31 print(1)' })).resolves.toMatchObject({ status: 'invalid' });
    await expect(index.dispatch({ input: 'run javascript' })).resolves.toMatchObject({ status: 'invalid', issues: [{ field: 'code' }] });
  });

  it.each(['JavaScript', 'PYTHON'])('validates normalized language %s before sending the request', async (language) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stdout: 'ok', stderr: '', error: '' }) });
    vi.stubGlobal('fetch', fetchMock);
    const index = commandIndex('run/$language', { ...runCommand, $parameter: { name: 'language', type: 'string' } }, glotConfig);
    await expect(index.dispatch({ input: `run ${language} print(1)` })).resolves.toMatchObject({ status: 'executed' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/${language.toLowerCase()}/latest`);
  });

  it('replies with a configuration hint instead of calling a hard-coded endpoint when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const index = commandIndex('run/$language', { ...runCommand, $parameter: { name: 'language', type: 'string' } });
    const result = await index.dispatch({ input: 'run js console.log(1)' });
    expect(result).toMatchObject({ status: 'executed' });
    expect(String((result as { value: unknown }).value)).toContain('未配置代码运行后端');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolveCodeRunnerBackend({ endpoint: '${CODE_RUNNER_ENDPOINT}' })).toBeUndefined();
    expect(resolveCodeRunnerBackend({ endpoint: '  ' })).toBeUndefined();
  });

  it.each([
    ['js', 'javascript'], ['node', 'javascript'], ['ts', 'typescript'], ['py', 'python'], ['python3', 'python'],
    ['sh', 'bash'], ['c++', 'cpp'], ['CPP', 'cpp'], ['rb', 'ruby'], ['golang', 'go'], ['go', 'go'], ['rs', 'rust'],
  ])('normalizes language alias %s → %s', (alias, canonical) => {
    expect(normalizeLanguage(alias)).toBe(canonical);
  });

  it('rejects prototype keys as languages', () => {
    expect(normalizeLanguage('constructor')).toBeUndefined();
    expect(normalizeLanguage('toString')).toBeUndefined();
  });

  it('accepts aliases through the command parser (run js …)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run: { stdout: '2\n', stderr: '', code: 0, signal: null } }) });
    vi.stubGlobal('fetch', fetchMock);
    const index = commandIndex('run/$language', { ...runCommand, $parameter: { name: 'language', type: 'string' } }, pistonConfig);
    await expect(index.dispatch({ input: 'run js console.log(1+1)' })).resolves.toMatchObject({ status: 'executed', value: '[stdout]\n2\n' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://127.0.0.1:2000/api/v2/execute');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ language: 'javascript', version: '*', files: [{ name: 'main.js' }] });
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBeUndefined();
  });

  it('reports piston compile failures and non-zero exits', async () => {
    const backend = { provider: 'piston' as const, endpoint: 'http://runner/execute', token: 'k' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ compile: { stdout: '', stderr: 'boom', code: 1 }, run: {} }) }));
    await expect(runCode('c++', 'int main(){', 5, undefined, backend)).resolves.toEqual({ stdout: '', stderr: 'boom', error: '进程退出码 1' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run: { stdout: '', stderr: 'err', code: 2, signal: null } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(runCode('sh', 'exit 2', 5, undefined, backend)).resolves.toEqual({ stdout: '', stderr: 'err', error: '进程退出码 2' });
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('k');
  });

  it('explains a 404 backend instead of echoing a bare status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }));
    const result = await runCode('py', 'print(1)', 5, undefined, { provider: 'glot', endpoint: 'https://glot.io/api/run' });
    expect(result.error).toContain('endpoint');
  });

  it('joins a glot endpoint without trailing slashes, linearly on long runs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stdout: 'ok', stderr: '', error: '' }) });
    vi.stubGlobal('fetch', fetchMock);
    await runCode('py', 'print(1)', 5, undefined, { provider: 'glot', endpoint: 'https://glot.io/api/run//' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://glot.io/api/run/python/latest');
    const started = performance.now();
    await runCode('py', 'print(1)', 5, undefined, { provider: 'glot', endpoint: `https://x${'/'.repeat(100_000)}a` });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('agent tool reads endpoint from plugin config', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const text = await runCodeTool.execute({ language: 'py', code: 'print(1)' }, { config: {}, locale: 'en' } as never);
    expect(text).toContain('No code-runner backend is configured');
  });
});

function commandIndex(localName: string, definition: CommandDefinition, config: Record<string, unknown> = {}) {
  const owner = rootPluginId();
  const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName, source: `/commands/${localName}/index.ts`, definition });
  const snapshot = { generation: 1, root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'root', packageName: '@test/plugin', packageRoot: '/test', children: [] }]]),
    config: new Map([[owner, config]]), resources: new Map([[owner, new Map()]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  } satisfies RuntimeSnapshot;
  return new CommandIndex([slot], snapshot);
}
