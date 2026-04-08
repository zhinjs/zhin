/**
 * @zhin.js/plugin-code-runner
 *
 * 沙箱代码执行插件 —— 通过 glot.io API 安全运行代码片段
 *
 * 功能：
 *   - AI 工具 run_code：AI 可调用执行代码
 *   - 命令「运行 <language> <code>」：用户直接运行代码
 *
 * 安全：
 *   - 代码长度上限 10000 字符
 *   - 语言白名单校验
 *   - 不执行本地代码，全部通过 glot.io 远程沙箱
 */
import { usePlugin, MessageCommand, ZhinTool } from 'zhin.js'

const { addCommand, addTool, logger } = usePlugin()

// ─── 常量 ────────────────────────────────────────────────────────────────────

const MAX_CODE_LENGTH = 10000

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
}

const GLOT_API_BASE = 'https://glot.io/api/run'

// ─── 核心执行函数 ────────────────────────────────────────────────────────────

interface RunResult {
  stdout: string
  stderr: string
  error: string
}

async function runCode(language: string, code: string): Promise<RunResult> {
  const lang = language.toLowerCase().trim()

  if (!SUPPORTED_LANGUAGES[lang]) {
    return {
      stdout: '',
      stderr: '',
      error: `不支持的语言: ${lang}。支持: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`,
    }
  }

  if (code.length > MAX_CODE_LENGTH) {
    return {
      stdout: '',
      stderr: '',
      error: `代码长度超过上限 ${MAX_CODE_LENGTH} 字符（当前 ${code.length}）`,
    }
  }

  const fileName = SUPPORTED_LANGUAGES[lang]
  const url = `${GLOT_API_BASE}/${lang}/latest`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [{ name: fileName, content: code }],
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      return {
        stdout: '',
        stderr: '',
        error: `API 请求失败: ${response.status} ${response.statusText}`,
      }
    }

    const data = (await response.json()) as RunResult
    return {
      stdout: data.stdout || '',
      stderr: data.stderr || '',
      error: data.error || '',
    }
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? '请求超时（30s）' : e?.message || '未知错误'
    return { stdout: '', stderr: '', error: msg }
  }
}

function formatResult(result: RunResult): string {
  const parts: string[] = []
  if (result.stdout) parts.push(`[stdout]\n${result.stdout}`)
  if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
  if (result.error) parts.push(`[error]\n${result.error}`)
  return parts.length ? parts.join('\n') : '（无输出）'
}

// ─── AI Tool: run_code ───────────────────────────────────────────────────────

addTool(
  new ZhinTool('run_code')
    .desc('在沙箱中运行代码片段，返回 stdout/stderr/error')
    .keyword('运行代码', '执行代码', 'run code', 'execute', '代码')
    .tag('code', 'run', 'execute', 'sandbox')
    .param('language', { type: 'string', description: '编程语言（python/javascript/typescript/go/rust/java/c/cpp/ruby/php）' }, true)
    .param('code', { type: 'string', description: '要执行的代码' }, true)
    .execute(async (args) => {
      const result = await runCode(args.language, args.code)
      return formatResult(result)
    })
    .toTool(),
)

// ─── 命令: 运行 ─────────────────────────────────────────────────────────────

addCommand(
  new MessageCommand('运行 <language:text> <code:text>')
    .desc('在沙箱中运行代码片段')
    .action(async (_message, result) => {
      const { language, code } = result.params as { language: string; code: string }
      logger.info(`运行代码: language=${language}, length=${code.length}`)
      const res = await runCode(language, code)
      return formatResult(res)
    }),
)
