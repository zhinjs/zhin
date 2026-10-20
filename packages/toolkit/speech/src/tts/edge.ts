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
      } finally {
        await unlink(tmpFile).catch(() => {});
      }
    },
  };
}
