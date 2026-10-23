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
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
          && 'path' in error && error.path === cmd) {
          throw new Error('未找到 edge-tts。请在 Bot 运行环境安装 edge-tts，并配置 speech.tts.edgeTtsCommand 为可执行文件路径；也可改用 openai / azure / custom TTS。', { cause: error });
        }
        throw error;
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    },
  };
}
