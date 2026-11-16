import { describe, expect, it, vi } from 'vitest';

const failure = vi.hoisted(() => ({ current: undefined as undefined | (Error & { code?: string; path?: string }) }));

vi.mock('node:child_process', () => ({
  execFile: (_file: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
    callback(failure.current ?? null);
  },
}));

const { createEdgeTtsProvider } = await import('../src/tts/edge.js');

function spawnError(code: string, path: string): Error & { code: string; path: string } {
  return Object.assign(new Error(`spawn ${path} ${code}`), { code, path });
}

describe('edge-tts spawn failures (#1250 batch 29)', () => {
  it('explains that Node cannot start a Windows .cmd / .bat without a shell (EINVAL)', async () => {
    const command = 'C:\\Users\\me\\AppData\\Roaming\\Python\\Scripts\\edge-tts.cmd';
    failure.current = spawnError('EINVAL', command);
    const error = await createEdgeTtsProvider({ edgeTtsCommand: command }).synthesize({ text: '你好' }).catch((caught: Error) => caught);
    expect(error.message).toContain('.cmd / .bat 脚本');
    expect(error.message).toContain('edge-tts.exe');
    // Only the last path segment: no user name.
    expect(error.message).toContain('「…/edge-tts.cmd」');
    expect(error.message).not.toContain('Users');
  });

  it('says a command with arguments is not supported', async () => {
    failure.current = spawnError('ENOENT', 'uvx edge-tts');
    const error = await createEdgeTtsProvider({ edgeTtsCommand: 'uvx edge-tts' }).synthesize({ text: '你好' }).catch((caught: Error) => caught);
    expect(error.message).toContain('只能填可执行文件路径，不支持带参数（例如 `uvx edge-tts`）');
  });

  it('keeps other failures as they are', async () => {
    failure.current = Object.assign(new Error('Command failed: edge-tts'), { code: 'ERR' });
    await expect(createEdgeTtsProvider({}).synthesize({ text: '你好' })).rejects.toThrow('Command failed: edge-tts');
  });
});
