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
