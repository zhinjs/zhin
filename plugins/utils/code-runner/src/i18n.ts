import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "language": {
    "zh-CN": "不支持的语言: {language}。支持: {supported}",
    "en": "Unsupported language: {language}. Supported: {supported}"
  },
  "length": {
    "zh-CN": "代码长度超过上限 {max} 字符（当前 {length}）",
    "en": "Code exceeds the {max}-character limit (currently {length})."
  },
  "request": {
    "zh-CN": "API 请求失败: {status} {text}",
    "en": "API request failed: {status} {text}"
  },
  "unconfigured": {
    "zh-CN": "未配置代码运行后端，请在 code-runner 配置里设置 endpoint（例如自建 Piston 的 http://127.0.0.1:2000/api/v2/execute）",
    "en": "No code-runner backend is configured. Set endpoint in the code-runner configuration (e.g. a self-hosted Piston at http://127.0.0.1:2000/api/v2/execute)."
  },
  "notFound": {
    "zh-CN": "代码运行后端返回 404，请检查 endpoint 与 provider 配置是否匹配: {status} {text}",
    "en": "The code-runner backend returned 404; check that endpoint matches provider: {status} {text}"
  },
  "exit": {
    "zh-CN": "进程退出码 {code}",
    "en": "Process exited with code {code}"
  },
  "signal": {
    "zh-CN": "进程被信号终止: {signal}",
    "en": "Process killed by signal: {signal}"
  },
  "timeout": {
    "zh-CN": "请求超时（{seconds}s）",
    "en": "Request timed out after {seconds}s."
  },
  "unknown": {
    "zh-CN": "未知错误",
    "en": "Unknown error"
  },
  "empty": {
    "zh-CN": "（无输出）",
    "en": "(no output)"
  }
});
