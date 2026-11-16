import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { TTSConfig, TtsProvider, TtsSynthesizeInput, TtsSynthesizeResult } from '../types.js';

const execFileAsync = promisify(execFile);

export function createEdgeTtsProvider(config: TTSConfig): TtsProvider {
  return {
    id: 'edge',
    async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
      const voice = input.voice || config.voice || 'zh-CN-XiaoxiaoNeural';
      const rate = config.rate || '+0%';
      const pitch = config.pitch || '+0Hz';
      const cmd = config.edgeTtsCommand || 'edge-tts';
      const tmpFile = join(tmpdir(), `zhin-tts-${randomBytes(8).toString('hex')}.mp3`);
      try {
        await execFileAsync(
          cmd,
          ['--voice', voice, `--rate=${rate}`, `--pitch=${pitch}`, '--text', input.text, '--write-media', tmpFile],
          { timeout: 30_000 },
        );
        const data = await readFile(tmpFile);
        return { data, format: 'mp3' };
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const spawnFailed = error && typeof error === 'object' && 'path' in error && error.path === cmd;
        if (spawnFailed && (code === 'ENOENT' || code === 'EACCES')) {
          // #1250: launchd / systemd 等托管环境的 PATH 很短（通常不含 ~/.local/bin），只写命令名会找不到。
          const what = code === 'EACCES' ? `edge-tts 命令「${cmd}」不可执行（没有执行权限）` : `未找到 edge-tts（命令「${cmd}」）`;
          throw new Error(`${what}。请在 Bot 运行环境安装 edge-tts（pip install edge-tts），并把 speech.tts.edgeTtsCommand 配置为可执行文件的绝对路径（launchd / systemd 等托管环境的 PATH 通常不含 ~/.local/bin，也不展开 ~）；也可改用 openai / azure / custom TTS。`, { cause: error });
        }
        throw error;
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    },
  };
}
