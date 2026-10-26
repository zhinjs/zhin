import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';

export const MAX_CODE_LENGTH = 10000;

const SUPPORTED_LANGUAGES: Record<string, string> = {
  python: 'main.py',
  javascript: 'main.js',
  typescript: 'main.ts',
  go: 'main.go',
  rust: 'main.rs',
  java: 'Main.java',
  c: 'main.c',
  cpp: 'main.cpp',
  ruby: 'main.rb',
  php: 'main.php',
};

export const supportedLanguages = Object.freeze(Object.keys(SUPPORTED_LANGUAGES));

const GLOT_API_BASE = 'https://glot.io/api/run';

interface RunResult {
  stdout: string;
  stderr: string;
  error: string;
}

export async function runCode(language: string, code: string, timeoutSeconds = 30, locale?: Locale): Promise<RunResult> {
  const lang = language.toLowerCase().trim();

  if (!SUPPORTED_LANGUAGES[lang]) {
    return {
      stdout: '',
      stderr: '',
      error: t(locale, 'language', { language: lang, supported: Object.keys(SUPPORTED_LANGUAGES).join(', ') }),
    };
  }

  if (code.length > MAX_CODE_LENGTH) {
    return {
      stdout: '',
      stderr: '',
      error: t(locale, 'length', { max: MAX_CODE_LENGTH, length: code.length }),
    };
  }

  const fileName = SUPPORTED_LANGUAGES[lang];
  const url = `${GLOT_API_BASE}/${lang}/latest`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ name: fileName, content: code }],
      }),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });

    if (!response.ok) {
      return {
        stdout: '',
        stderr: '',
        error: t(locale, 'request', { status: response.status, text: response.statusText }),
      };
    }

    const data = (await response.json()) as RunResult;
    return {
      stdout: data.stdout || '',
      stderr: data.stderr || '',
      error: data.error || '',
    };
  } catch (e: unknown) {
    const err = e as Error;
    const msg = err.name === 'TimeoutError' ? t(locale, 'timeout', { seconds: timeoutSeconds }) : err.message || t(locale, 'unknown');
    return { stdout: '', stderr: '', error: msg };
  }
}

export function formatResult(result: RunResult, locale?: Locale): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(`[stdout]\n${result.stdout}`);
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
  if (result.error) parts.push(`[error]\n${result.error}`);
  return parts.length ? parts.join('\n') : t(locale, 'empty');
}
