import { constants as fsConstants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { delimiter, extname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { AudioTranscriptionPort, MediaBinaryPayload } from '@zhin.js/agent';
import type { ConfigDocumentPort, RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import {
  expandEnvironmentValue,
  type RootResourceInstaller,
} from '@zhin.js/runtime';

export interface SpeechHostConfig {
  readonly stt?: Record<string, unknown>;
  readonly tts?: Record<string, unknown>;
}

export interface SpeechHostTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>): Promise<unknown>;
  readonly source?: string;
  readonly requiresApproval?: 'always' | 'once' | 'never' | 'on-risk';
}

/**
 * #1250 第 29 批 `speech-ready-without-tts-binary`：配置的语音能力依赖的外部命令不能执行。
 * 只有 `edge` TTS 依赖本机命令（`edge-tts`）；其余 provider 走 HTTP（openai / azure / custom TTS、
 * ollama / openai STT），缺少的是服务或密钥，在调用时报错，不在启动时探测。
 */
export interface SpeechDependencyIssue {
  readonly feature: 'tts';
  readonly provider: 'edge';
  /** Configuration path of the command (`speech.tts.edgeTtsCommand`). */
  readonly configPath: string;
  /** The command as configured (`edge-tts` by default). */
  readonly command: string;
  /**
   * `not-found`: not on PATH / no such file; `not-executable`: exists but cannot run (no execute
   * bit; a Windows `.cmd` / `.bat`); `has-arguments`: a command line instead of a path (`uvx edge-tts`);
   * `timeout`: the check did not finish.
   */
  readonly reason: 'not-found' | 'not-executable' | 'has-arguments' | 'timeout';
  /** Model- and log-facing explanation (Chinese, with the fix). */
  readonly message: string;
  /** When the check ran (ms). */
  readonly at: number;
}

export interface SpeechHostHandle extends AudioTranscriptionPort {
  readonly tools: readonly SpeechHostTool[];
  readonly sttProvider: string;
  readonly ttsProvider: string;
  /** TTS is enabled and no dependency issue blocks it (a `timeout` check does not block). */
  readonly ttsAvailable: boolean;
  /** Current dependency issues (checked again when `voice_tts` is called while TTS is unavailable). */
  dependencyIssues(): readonly SpeechDependencyIssue[];
  /** Inbound preprocess: download URL and transcribe. */
  transcribeUrl(audioUrl: string): Promise<string | null>;
}

interface SpeechPipelineLike {
  transcribe(input: { data: Buffer; mimeType?: string }): Promise<string>;
  synthesize(input: {
    text: string;
    voice?: string;
    provider?: string;
  }): Promise<{ data: Buffer; format: string }>;
}

const logger = getLogger('Speech');

/** Budget of the startup check of one external command (a PATH lookup; nothing is executed). */
export const SPEECH_DEPENDENCY_CHECK_TIMEOUT_MS = 3_000;
const EDGE_TTS_CONFIG_PATH = 'speech.tts.edgeTtsCommand';
const DEFAULT_EDGE_TTS_COMMAND = 'edge-tts';
const PATH_SEPARATOR = /[\\/]/u;

export interface SpeechDependencyCheckOptions {
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly cwd?: string;
  readonly now?: () => number;
  /** Replaces the PATH lookup (tests). */
  readonly probe?: (command: string) => Promise<ExecutableCheck>;
}

export type ExecutableCheck = 'ok' | 'not-found' | 'not-executable';

/**
 * Windows: Node (>= 22, CVE-2024-27980) refuses to start `.cmd` / `.bat` through `execFile` without a
 * shell (`EINVAL`), so only `.exe` / `.com` count as runnable, whatever `PATHEXT` lists.
 */
const WINDOWS_RUNNABLE = new Set(['.exe', '.com']);
const WINDOWS_SCRIPTS = ['.cmd', '.bat', '.CMD', '.BAT'];

/**
 * Whether `command` can be started the way `execFile` starts it: a path (absolute, or relative to
 * `cwd`) must be an executable file; a bare name must resolve to one on `PATH` (on Windows with a
 * `PATHEXT` extension, `.exe` / `.com` only). Nothing is executed, so the check has no side effects.
 */
export async function checkExecutable(command: string, options: SpeechDependencyCheckOptions = {}): Promise<ExecutableCheck> {
  const env = options.env ?? process.env;
  const windows = (options.platform ?? process.platform) === 'win32';
  const mode = windows ? fsConstants.F_OK : fsConstants.X_OK;
  const isFile = async (candidate: string): Promise<boolean> => {
    try { return (await stat(candidate)).isFile(); } catch { return false; }
  };
  const probe = async (file: string): Promise<ExecutableCheck> => {
    if (windows) {
      const ext = extname(file).toLowerCase();
      if (ext) {
        if (!(await isFile(file))) return 'not-found';
        return WINDOWS_RUNNABLE.has(ext) ? 'ok' : 'not-executable';
      }
      const extensions = [...new Set((env.PATHEXT ?? '.COM;.EXE').split(';').filter(Boolean)
        .filter(item => WINDOWS_RUNNABLE.has(item.toLowerCase())).flatMap(item => [item, item.toLowerCase()]))];
      for (const item of extensions) if (await isFile(`${file}${item}`)) return 'ok';
      // Only a script wrapper exists: present, but not startable without a shell.
      for (const item of WINDOWS_SCRIPTS) if (await isFile(`${file}${item}`)) return 'not-executable';
      return 'not-found';
    }
    if (!(await isFile(file))) return 'not-found';
    try {
      await access(file, mode);
      return 'ok';
    } catch {
      return 'not-executable';
    }
  };
  const trimmed = command.trim();
  if (!trimmed) return 'not-found';
  if (isAbsolute(trimmed) || PATH_SEPARATOR.test(trimmed)) return probe(resolvePath(options.cwd ?? process.cwd(), trimmed));
  const pathValue = (windows ? env.Path ?? env.PATH : env.PATH) ?? '';
  let found: ExecutableCheck = 'not-found';
  for (const directory of pathValue.split(windows ? ';' : delimiter).filter(Boolean)) {
    const result = await probe(join(directory, trimmed));
    if (result === 'ok') return 'ok';
    if (result === 'not-executable') found = result;
  }
  return found;
}

/**
 * The command as logs and the model may show it: a path keeps only its last segment, so a home
 * directory (user name) never leaves the host (#1250 第 29 批 review).
 */
export function displaySpeechCommand(command: string): string {
  if (!PATH_SEPARATOR.test(command)) return command;
  const last = command.split(/[\\/]/u).filter(Boolean).pop() ?? command;
  return `…/${last}`;
}

function edgeTtsIssueMessage(command: string, reason: SpeechDependencyIssue['reason']): string {
  const shown = displaySpeechCommand(command);
  if (reason === 'has-arguments') {
    return `${EDGE_TTS_CONFIG_PATH}（「${shown}」）只能填可执行文件路径，不支持带参数（例如 \`uvx edge-tts\`）。`
      + '请填 edge-tts 可执行文件的绝对路径（pip install edge-tts 安装后用 command -v edge-tts 查看）；也可以改用 openai / azure / custom TTS。';
  }
  const what = reason === 'timeout'
    ? `检查 edge-tts 命令「${shown}」能否执行时超时`
    : reason === 'not-executable'
      ? `edge-tts 命令「${shown}」存在但不能直接执行（没有执行权限；Windows 上 .cmd / .bat 不能直接运行，需指向 .exe）`
      : `未找到 edge-tts（命令「${shown}」${PATH_SEPARATOR.test(command) ? '不存在' : '不在运行环境的 PATH 中'}）`;
  return `${what}。请在 Bot 运行环境安装 edge-tts（pip install edge-tts），并把 ${EDGE_TTS_CONFIG_PATH} 配置为可执行文件的绝对路径`
    + '（launchd / systemd 等托管环境的 PATH 通常不含 ~/.local/bin，也不展开 ~）；也可以改用 openai / azure / custom TTS。';
}

/**
 * Startup check of the external commands the configured speech features need (#1250 第 29 批).
 * Only the `edge` TTS provider runs a local command; the other providers are HTTP services and
 * fail at call time with their own reason.
 */
export async function checkSpeechDependencies(
  config: SpeechHostConfig | undefined,
  options: SpeechDependencyCheckOptions = {},
): Promise<readonly SpeechDependencyIssue[]> {
  if (!config || config.tts?.enabled === false) return [];
  const provider = typeof config.tts?.provider === 'string' ? config.tts.provider : 'edge';
  if (provider !== 'edge') return [];
  const configured = config.tts?.edgeTtsCommand;
  const command = typeof configured === 'string' && configured.trim() ? configured.trim() : DEFAULT_EDGE_TTS_COMMAND;
  const timeoutMs = options.timeoutMs ?? SPEECH_DEPENDENCY_CHECK_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  let result: ExecutableCheck | 'timeout';
  try {
    const probe = options.probe ?? ((value: string) => checkExecutable(value, options));
    result = await Promise.race([probe(command).catch((): ExecutableCheck => 'not-found'), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (result === 'ok') return [];
  // A value with whitespace that is not itself an executable file is a command line (`uvx edge-tts`).
  let reason: SpeechDependencyIssue['reason'] = result;
  if (result === 'not-found' && /\s/u.test(command)) {
    const head = command.split(/\s+/u)[0]!;
    const probe = options.probe ?? ((value: string) => checkExecutable(value, options));
    // `uvx edge-tts`: a program plus arguments. A path with a space in it (`/Users/John Smith/…`) stays `not-found`.
    if (!PATH_SEPARATOR.test(head) || await probe(head).catch(() => 'not-found') === 'ok') reason = 'has-arguments';
  }
  return [Object.freeze({
    feature: 'tts' as const,
    provider: 'edge' as const,
    configPath: EDGE_TTS_CONFIG_PATH,
    command,
    reason,
    message: edgeTtsIssueMessage(command, reason),
    at: (options.now ?? Date.now)(),
  })];
}

/** A `timeout` result is reported but does not stop the tool from trying. */
function blockingIssue(issues: readonly SpeechDependencyIssue[]): SpeechDependencyIssue | undefined {
  return issues.find(issue => issue.reason !== 'timeout');
}

export async function resolveSpeechConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<SpeechHostConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const speech = (document as Record<string, unknown>).speech;
  if (!speech || typeof speech !== 'object') return undefined;
  return expandEnvironmentValue(speech, (key) => process.env[key]) as SpeechHostConfig;
}

/**
 * Optional Speech Host:
 * - top-level `speech:` → create one host-owned Speech pipeline
 * - exposes voice_stt / voice_tts tools for Agent Host
 */
export async function prepareSpeechHost(
  config: SpeechHostConfig | undefined,
  options: SpeechDependencyCheckOptions = {},
): Promise<SpeechHostHandle | undefined> {
  if (!config) return undefined;
  try {
    const mod = await import('@zhin.js/speech') as {
      createSpeechPipeline: (
        config?: SpeechHostConfig,
        logger?: { debug?(m: string): void; warn?(m: string): void },
      ) => SpeechPipelineLike;
    };
    const pipeline = mod.createSpeechPipeline(config, logger);
    const sttProvider = typeof config.stt?.provider === 'string' ? config.stt.provider : 'ollama';
    const ttsProvider = typeof config.tts?.provider === 'string' ? config.tts.provider : 'edge';
    let issues = await checkSpeechDependencies(config, options);
    for (const issue of issues) {
      logger.warn(formatCompact({ op: 'speech_dependency_unavailable', feature: issue.feature, provider: issue.provider,
        command: displaySpeechCommand(issue.command), reason: issue.reason }));
    }
    const configuredCommand = typeof config.tts?.edgeTtsCommand === 'string' ? config.tts.edgeTtsCommand.trim() : '';
    const dependencies: SpeechDependencyGate = {
      redact: (text) => configuredCommand && PATH_SEPARATOR.test(configuredCommand)
        ? text.split(configuredCommand).join(displaySpeechCommand(configuredCommand)) : text,
      // A call while TTS is unavailable checks again, so installing edge-tts takes effect without a restart.
      async ttsBlocked(provider) {
        if ((provider ?? ttsProvider) !== 'edge' || !blockingIssue(issues)) return undefined;
        issues = await checkSpeechDependencies(config, options);
        return blockingIssue(issues);
      },
    };
    const tools = buildSpeechTools(pipeline, dependencies).filter((tool) =>
      tool.name === 'voice_tts' ? config.tts?.enabled !== false : config.stt?.enabled !== false);
    return Object.freeze({
      tools,
      sttProvider,
      ttsProvider,
      get ttsAvailable() { return config.tts?.enabled !== false && !blockingIssue(issues); },
      dependencyIssues: () => issues,
      async transcribe(payload: MediaBinaryPayload, signal?: AbortSignal): Promise<string | undefined> {
        signal?.throwIfAborted();
        const text = await pipeline.transcribe({
          data: Buffer.from(payload.base64, 'base64'),
          mimeType: payload.mimeType,
        });
        signal?.throwIfAborted();
        return text.trim() || undefined;
      },
      async transcribeUrl(audioUrl: string): Promise<string | null> {
        const url = audioUrl.trim();
        if (!url) return null;
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`download failed: ${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          const mimeType = response.headers.get('content-type') || 'audio/wav';
          const text = await pipeline.transcribe({ data: buffer, mimeType });
          const trimmed = text.trim();
          return trimmed || null;
        } catch (error) {
          logger.warn(formatCompact({
            op: 'speech_host_stt_fail',
            error: error instanceof Error ? error.message : String(error),
          }));
          return null;
        }
      },
    });
  } catch (error) {
    logger.warn(formatCompact({
      op: 'speech_host_skip',
      reason: 'speech_package_unavailable',
      error: error instanceof Error ? error.message : String(error),
    }));
    return undefined;
  }
}

export function installSpeechHost(handle: SpeechHostHandle | undefined): RootResourceInstaller {
  return () => {
    if (!handle) return;
    const line = formatSpeechReadyLine(handle);
    if (blockingIssue(handle.dependencyIssues())) logger.warn(line);
    else logger.info(line);
  };
}

/**
 * Startup line of the Speech Host. #1250 第 29 批：外部命令不可用时不写「ready」，写 `degraded` 并标出
 * TTS 不可用（同时以 warn 记录；Console「需要你处理」同步列出）。
 */
export function formatSpeechReadyLine(handle: Pick<SpeechHostHandle, 'sttProvider' | 'ttsProvider' | 'tools' | 'dependencyIssues'>): string {
  const tools = handle.tools.map((tool) => tool.name).join(',');
  const blocked = blockingIssue(handle.dependencyIssues());
  if (!blocked) return `ready | stt: ${handle.sttProvider} | tts: ${handle.ttsProvider} | tools: ${tools}`;
  return `degraded | stt: ${handle.sttProvider} | tts: ${handle.ttsProvider} (unavailable: ${blocked.reason} ${displaySpeechCommand(blocked.command)}) | tools: ${tools}`;
}

interface SpeechDependencyGate {
  /** Replaces the configured command path with its display form in a message for the model. */
  redact(text: string): string;
  /** The issue that stops `provider` (default: the configured TTS provider) from running, after a re-check. */
  ttsBlocked(provider?: string): Promise<SpeechDependencyIssue | undefined>;
}

function buildSpeechTools(pipeline: SpeechPipelineLike, dependencies: SpeechDependencyGate): SpeechHostTool[] {
  return [
    {
      name: 'voice_stt',
      description: '将语音/音频消息转写为文字',
      source: 'speech',
      parameters: {
        type: 'object',
        properties: {
          audio_url: { type: 'string', description: '音频文件 URL' },
          file_path: { type: 'string', description: '本地音频绝对路径' },
        },
      },
      async execute(args) {
        const audioUrl = typeof args.audio_url === 'string' ? args.audio_url : '';
        const filePath = typeof args.file_path === 'string' ? args.file_path : '';
        if (!audioUrl && !filePath) return { error: '需要提供 audio_url 或 file_path' };
        try {
          let buffer: Buffer;
          let mimeType = 'audio/wav';
          if (filePath) {
            buffer = await readFile(filePath);
          } else {
            const response = await fetch(audioUrl);
            if (!response.ok) throw new Error(`下载音频失败: ${response.status}`);
            buffer = Buffer.from(await response.arrayBuffer());
            mimeType = response.headers.get('content-type') || mimeType;
          }
          const text = await pipeline.transcribe({ data: buffer, mimeType });
          return { text: text || '(无法识别语音内容)' };
        } catch (error) {
          return { error: `语音识别失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: 'voice_tts',
      description: '将简短口语合成为语音并自动发到当前会话。对方明确要求语音时使用；对方先发语音、情绪化短句或私聊中可以偶尔使用，长内容使用文字。成功后无需再次发送相同语音；失败改用文字，不声称已发出。',
      source: 'speech',
      // 只合成当前会话回复，不接受文件路径或其他会话目标；语音转写仍走原审批。
      requiresApproval: 'never',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要转换为语音的文字' },
          voice: { type: 'string', description: '语音类型（覆盖默认）' },
          provider: {
            type: 'string',
            description: 'TTS provider：edge | openai | azure | custom',
            enum: ['edge', 'openai', 'azure', 'custom'],
          },
        },
        required: ['text'],
      },
      async execute(args) {
        const text = typeof args.text === 'string' ? args.text : '';
        if (!text) return { error: '需要提供 text' };
        const provider = typeof args.provider === 'string' ? args.provider : undefined;
        // #1250 第 29 批：已知缺少外部命令时直接给出原因（模型据此如实告诉用户），不再跑一次注定失败的合成。
        const blocked = await dependencies.ttsBlocked(provider);
        if (blocked) return { error: `语音合成不可用: ${blocked.message}` };
        try {
          const result = await pipeline.synthesize({
            text,
            voice: typeof args.voice === 'string' ? args.voice : undefined,
            provider,
          });
          // `audio` is for the host only: the Agent removes it before the model sees the result and
          // sends it with the reply through the outbound chain (#1250 第 29 批); the model gets metadata.
          return {
            audio: result.data.toString('base64'),
            format: result.format,
            size: result.data.length,
          };
        } catch (error) {
          // Only the command's last path segment reaches the model (no home directory).
          return { error: dependencies.redact(`语音合成失败: ${error instanceof Error ? error.message : String(error)}`) };
        }
      },
    },
  ];
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}
