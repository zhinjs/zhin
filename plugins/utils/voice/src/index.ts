/**
 * @zhin.js/plugin-voice
 *
 * 语音输入/输出插件
 *
 * 功能：
 *   - STT (Speech-to-Text): 通过 Whisper (Ollama/OpenAI API) 将语音消息转写为文字
 *   - TTS (Text-to-Speech): 通过 edge-tts 将文字回复转换为语音消息
 *
 * 配置方式（zhin.config.yml）：
 * ```yaml
 * plugins:
 *   voice:
 *     stt:
 *       enabled: true
 *       provider: ollama          # ollama | openai
 *       model: whisper            # Whisper 模型
 *       host: http://localhost:11434
 *     tts:
 *       enabled: true
 *       voice: zh-CN-XiaoxiaoNeural  # edge-tts 语音
 *       rate: +0%                    # 语速
 *       pitch: +0Hz                  # 音调
 *       edgeTtsCommand: edge-tts     # edge-tts CLI 路径
 * ```
 */
import { usePlugin, ZhinTool } from 'zhin.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink, writeFile } from 'fs/promises';
import { randomBytes } from 'crypto';

const execAsync = promisify(exec);
const plugin = usePlugin();
const { logger, root } = plugin;

// ─── 配置 ────────────────────────────────────────────────────────────────────

interface STTConfig {
  enabled?: boolean;
  provider?: 'ollama' | 'openai';
  model?: string;
  host?: string;
  apiKey?: string;
}

interface TTSConfig {
  enabled?: boolean;
  voice?: string;
  rate?: string;
  pitch?: string;
  edgeTtsCommand?: string;
}

interface VoiceConfig {
  stt?: STTConfig;
  tts?: TTSConfig;
}

const configService = root.inject('config');
const appConfig = configService?.get<{ voice?: VoiceConfig }>('zhin.config.yml') || {};
const config: VoiceConfig = {
  stt: { enabled: true, provider: 'ollama', model: 'whisper', host: 'http://localhost:11434' },
  tts: { enabled: true, voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', pitch: '+0Hz', edgeTtsCommand: 'edge-tts' },
  ...appConfig.voice,
};

// ─── STT: Speech-to-Text ─────────────────────────────────────────────────────

/**
 * 通过 Ollama Whisper 进行语音识别
 */
async function transcribeWithOllama(audioData: Buffer, mimeType: string = 'audio/wav'): Promise<string> {
  const sttConfig = config.stt || {};
  const host = sttConfig.host || 'http://localhost:11434';
  const model = sttConfig.model || 'whisper';

  // 将音频数据转为 base64
  const base64Audio = audioData.toString('base64');

  // Ollama audio API
  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: '请将这段音频转写为文字，只输出转写的文字内容，不要加任何说明。',
        images: [base64Audio], // Ollama 多模态格式
      }],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama STT failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { message?: { content?: string } };
  return data.message?.content?.trim() || '';
}

/**
 * 通过 OpenAI Whisper API 进行语音识别
 */
async function transcribeWithOpenAI(audioData: Buffer, mimeType: string = 'audio/wav'): Promise<string> {
  const sttConfig = config.stt || {};
  const host = sttConfig.host || 'https://api.openai.com';
  const model = sttConfig.model || 'whisper-1';
  const apiKey = sttConfig.apiKey || '';

  // 写入临时文件
  const tmpFile = join(tmpdir(), `zhin-stt-${randomBytes(8).toString('hex')}.wav`);
  await writeFile(tmpFile, audioData);

  try {
    const ext = mimeType.includes('mp3') ? 'mp3' : 'wav';
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioData)], { type: mimeType });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', model);
    formData.append('language', 'zh');

    const response = await fetch(`${host}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI STT failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { text?: string };
    return data.text?.trim() || '';
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

/**
 * 通用语音转文字
 */
async function speechToText(audioData: Buffer, mimeType?: string): Promise<string> {
  const provider = config.stt?.provider || 'ollama';
  if (provider === 'openai') {
    return transcribeWithOpenAI(audioData, mimeType);
  }
  return transcribeWithOllama(audioData, mimeType);
}

// ─── TTS: Text-to-Speech ─────────────────────────────────────────────────────

/**
 * 通过 edge-tts 将文字转为语音
 *
 * 依赖: pip install edge-tts
 */
async function textToSpeech(text: string): Promise<Buffer> {
  const ttsConfig = config.tts || {};
  const voice = ttsConfig.voice || 'zh-CN-XiaoxiaoNeural';
  const rate = ttsConfig.rate || '+0%';
  const pitch = ttsConfig.pitch || '+0Hz';
  const cmd = ttsConfig.edgeTtsCommand || 'edge-tts';

  const tmpFile = join(tmpdir(), `zhin-tts-${randomBytes(8).toString('hex')}.mp3`);

  // 转义引号
  const safeText = text.replace(/"/g, '\\"').replace(/'/g, "\\'");

  try {
    await execAsync(
      `${cmd} --voice "${voice}" --rate="${rate}" --pitch="${pitch}" --text "${safeText}" --write-media "${tmpFile}"`,
      { timeout: 30_000 },
    );
    const audioBuffer = await readFile(tmpFile);
    return audioBuffer;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

// ─── 注册 AI 工具 ────────────────────────────────────────────────────────────

const allTools: ZhinTool[] = [];

if (config.stt?.enabled !== false) {
  const sttTool = new ZhinTool('voice.stt')
    .desc('将语音/音频消息转写为文字')
    .keyword('语音转文字', '语音识别', 'stt', 'transcribe', '听')
    .tag('voice', 'stt', '语音')
    .param('audio_url', { type: 'string', description: '音频文件 URL' }, true)
    .execute(async (args: Record<string, any>) => {
      const { audio_url } = args;
      if (!audio_url) return { error: '需要提供 audio_url' };
      try {
        const response = await fetch(audio_url);
        if (!response.ok) throw new Error(`下载音频失败: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'audio/wav';
        const text = await speechToText(buffer, contentType);
        return { text: text || '(无法识别语音内容)' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `语音识别失败: ${msg}` };
      }
    });

  allTools.push(sttTool);
  logger.info('Voice STT tool registered');
}

if (config.tts?.enabled !== false) {
  const ttsTool = new ZhinTool('voice.tts')
    .desc('将文字转换为语音消息')
    .keyword('文字转语音', '语音合成', 'tts', '朗读', '读出来')
    .tag('voice', 'tts', '语音')
    .param('text', { type: 'string', description: '要转换为语音的文字内容' }, true)
    .execute(async (args: Record<string, any>) => {
      const { text } = args;
      if (!text) return { error: '需要提供 text' };
      try {
        const audioBuffer = await textToSpeech(text);
        // 返回 base64 编码的音频数据
        const base64 = audioBuffer.toString('base64');
        return {
          audio: base64,
          format: 'mp3',
          size: audioBuffer.length,
          message: `语音合成完成 (${(audioBuffer.length / 1024).toFixed(1)} KB)`,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `语音合成失败: ${msg}` };
      }
    })
    .action(async (message: any) => {
      const text = message.$raw?.toString() || '';
      if (!text) return '请提供要转换的文字';
      try {
        const audioBuffer = await textToSpeech(text);
        const base64 = audioBuffer.toString('base64');
        return `<audio url="data:audio/mp3;base64,${base64}"/>`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `语音合成失败: ${msg}`;
      }
    });

  allTools.push(ttsTool);
  logger.info('Voice TTS tool registered');
}

allTools.forEach((tool) => plugin.addTool(tool.toTool()));

// 声明 Skill 元数据
plugin.declareSkill({
  description: '语音输入(STT)和语音输出(TTS)能力，支持语音转文字和文字转语音',
  keywords: ['语音', '朗读', 'stt', 'tts', 'voice', '转文字', '转语音'],
  tags: ['voice', 'audio', 'stt', 'tts'],
});

logger.info(`Voice plugin loaded (STT: ${config.stt?.enabled !== false ? 'on' : 'off'}, TTS: ${config.tts?.enabled !== false ? 'on' : 'off'})`);
