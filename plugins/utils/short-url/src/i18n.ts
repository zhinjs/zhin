import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "invalid": {
    "zh-CN": "请提供有效的 HTTP/HTTPS 链接",
    "en": "Provide a valid HTTP or HTTPS URL."
  },
  "shortened": {
    "zh-CN": "短链接: {url}",
    "en": "Short URL: {url}"
  },
  "expanded": {
    "zh-CN": "原始链接: {url}",
    "en": "Original URL: {url}"
  },
  "shortFailed": {
    "zh-CN": "缩短失败: {detail}",
    "en": "Could not shorten the URL: {detail}"
  },
  "expandFailed": {
    "zh-CN": "展开失败: {detail}",
    "en": "Could not expand the URL: {detail}"
  },
  "serviceError": {
    "zh-CN": "is.gd 返回 {status}",
    "en": "is.gd returned HTTP {status}"
  },
  "noResult": {
    "zh-CN": "缩短服务未返回链接",
    "en": "The shortening service did not return a URL."
  },
  "expandError": {
    "zh-CN": "无法展开链接 ({status})",
    "en": "Could not expand the URL (HTTP {status})"
  }
});
