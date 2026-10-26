import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "days": {
    "zh-CN": "{days}天{hours}小时",
    "en": "{days}d {hours}h"
  },
  "hours": {
    "zh-CN": "{hours}小时{minutes}分钟",
    "en": "{hours}h {minutes}m"
  },
  "minutes": {
    "zh-CN": "{minutes}分钟",
    "en": "{minutes}m"
  },
  "seconds": {
    "zh-CN": "{seconds}秒",
    "en": "{seconds}s"
  },
  "title": {
    "zh-CN": "📊 进程监控状态",
    "en": "📊 Process status"
  },
  "pid": {
    "zh-CN": "🚀 当前 PID: {pid}",
    "en": "🚀 Current PID: {pid}"
  },
  "uptime": {
    "zh-CN": "⏱️  运行时长: {duration}",
    "en": "⏱️  Uptime: {duration}"
  },
  "memory": {
    "zh-CN": "💾 内存使用: {memory} MB",
    "en": "💾 Memory usage: {memory} MB"
  },
  "restarts": {
    "zh-CN": "🔄 总重启: {count} 次",
    "en": "🔄 Total restarts: {count}"
  },
  "crashes": {
    "zh-CN": "💥 崩溃: {count} 次",
    "en": "💥 Crashes: {count}"
  },
  "totalUptime": {
    "zh-CN": "📈 累计运行: {duration}",
    "en": "📈 Total uptime: {duration}"
  },
  "host": {
    "zh-CN": "🖥️  主机: {host}",
    "en": "🖥️  Host: {host}"
  },
  "platform": {
    "zh-CN": "💻 平台: {platform}",
    "en": "💻 Platform: {platform}"
  }
});
