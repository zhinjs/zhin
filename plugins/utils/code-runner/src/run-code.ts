import type { Locale } from 'zhin.js/i18n';
import type { CodeRunnerBackend } from './config.js';
import { messages as t } from './i18n.js';

export const MAX_CODE_LENGTH = 10000;

const SUPPORTED_LANGUAGES: Record<string, string> = {
  python: 'main.py',
  javascript: 'main.js',
  typescript: 'main.ts',
  bash: 'main.sh',
  go: 'main.go',
  rust: 'main.rs',
  java: 'Main.java',
  c: 'main.c',
  cpp: 'main.cpp',
  ruby: 'main.rb',
  php: 'main.php',
};

/** Common short names and spellings users type in chat → canonical language. */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  node: 'javascript',
  nodejs: 'javascript',
  ts: 'typescript',
  py: 'python',
  py3: 'python',
  python3: 'python',
  sh: 'bash',
  shell: 'bash',
  'c++': 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  rb: 'ruby',
  golang: 'go',
  rs: 'rust',
};

export const supportedLanguages = Object.freeze(Object.keys(SUPPORTED_LANGUAGES));
export const languageAliases = Object.freeze({ ...LANGUAGE_ALIASES });

/** Canonical language for a name or alias (case-insensitive); `undefined` when unsupported. */
export function normalizeLanguage(language: string): string | undefined {
  const lang = language.toLowerCase().trim();
  // Own-property checks: `constructor` / `toString` must not pass as languages.
  if (Object.hasOwn(SUPPORTED_LANGUAGES, lang)) return lang;
  if (Object.hasOwn(LANGUAGE_ALIASES, lang)) return LANGUAGE_ALIASES[lang];
  return undefined;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  error: string;
}

interface PistonStage { stdout?: string; stderr?: string; code?: number | null; signal?: string | null; output?: string }

function failure(error: string): RunResult {
  return { stdout: '', stderr: '', error };
}

function supportedList(): string {
  return `${supportedLanguages.join(', ')}（${Object.keys(LANGUAGE_ALIASES).join(', ')}）`;
}

/**
 * Runs `code` on the configured backend. Without a `backend` (endpoint not configured) it returns
 * the localized "not configured" hint and sends no request.
 */
export async function runCode(
  language: string,
  code: string,
  timeoutSeconds = 30,
  locale?: Locale,
  backend?: CodeRunnerBackend,
): Promise<RunResult> {
  const lang = normalizeLanguage(language);
  if (!lang) return failure(t(locale, 'language', { language: language.toLowerCase().trim(), supported: supportedList() }));
  if (code.length > MAX_CODE_LENGTH) return failure(t(locale, 'length', { max: MAX_CODE_LENGTH, length: code.length }));
  if (!backend) return failure(t(locale, 'unconfigured'));

  const fileName = SUPPORTED_LANGUAGES[lang]!;
  const glot = backend.provider === 'glot';
  const url = glot ? `${backend.endpoint.replace(/\/+$/u, '')}/${lang}/latest` : backend.endpoint;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (backend.token) headers.Authorization = glot ? `Token ${backend.token}` : backend.token;
  const body = glot
    ? { files: [{ name: fileName, content: code }] }
    : { language: lang, version: '*', files: [{ name: fileName, content: code }] };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });

    if (!response.ok) {
      const key = response.status === 404 ? 'notFound' : 'request';
      return failure(t(locale, key, { status: response.status, text: response.statusText }));
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (glot) {
      return { stdout: str(data.stdout), stderr: str(data.stderr), error: str(data.error) };
    }
    return fromPiston(data, locale);
  } catch (e: unknown) {
    const err = e as Error;
    return failure(err.name === 'TimeoutError' ? t(locale, 'timeout', { seconds: timeoutSeconds }) : err.message || t(locale, 'unknown'));
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function fromPiston(data: Record<string, unknown>, locale?: Locale): RunResult {
  if (typeof data.message === 'string' && !data.run) return failure(data.message);
  const compile = (data.compile ?? undefined) as PistonStage | undefined;
  if (compile && typeof compile.code === 'number' && compile.code !== 0) {
    return { stdout: str(compile.stdout), stderr: str(compile.stderr), error: t(locale, 'exit', { code: compile.code }) };
  }
  const run = (data.run ?? {}) as PistonStage;
  const error = run.signal ? t(locale, 'signal', { signal: run.signal })
    : typeof run.code === 'number' && run.code !== 0 ? t(locale, 'exit', { code: run.code }) : '';
  return { stdout: str(run.stdout), stderr: str(run.stderr), error };
}

export function formatResult(result: RunResult, locale?: Locale): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(`[stdout]\n${result.stdout}`);
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
  if (result.error) parts.push(`[error]\n${result.error}`);
  return parts.length ? parts.join('\n') : t(locale, 'empty');
}
