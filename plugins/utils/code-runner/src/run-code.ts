const MAX_CODE_LENGTH = 10000;

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

const GLOT_API_BASE = 'https://glot.io/api/run';

interface RunResult {
  stdout: string;
  stderr: string;
  error: string;
}

export async function runCode(language: string, code: string): Promise<RunResult> {
  const lang = language.toLowerCase().trim();

  if (!SUPPORTED_LANGUAGES[lang]) {
    return {
      stdout: '',
      stderr: '',
      error: `不支持的语言: ${lang}。支持: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`,
    };
  }

  if (code.length > MAX_CODE_LENGTH) {
    return {
      stdout: '',
      stderr: '',
      error: `代码长度超过上限 ${MAX_CODE_LENGTH} 字符（当前 ${code.length}）`,
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
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      return {
        stdout: '',
        stderr: '',
        error: `API 请求失败: ${response.status} ${response.statusText}`,
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
    const msg = err.name === 'TimeoutError' ? '请求超时（30s）' : err.message || '未知错误';
    return { stdout: '', stderr: '', error: msg };
  }
}

export function formatResult(result: RunResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(`[stdout]\n${result.stdout}`);
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`);
  if (result.error) parts.push(`[error]\n${result.error}`);
  return parts.length ? parts.join('\n') : '（无输出）';
}
