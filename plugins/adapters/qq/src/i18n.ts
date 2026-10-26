import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  bindTaskFailed: { 'zh-CN': '获取绑定任务失败: {error}', en: 'Could not create the binding task: {error}' },
  "kindPrompt": {
    "zh-CN": "请回复 public（公域）或 private（私域），确认后一次性写入 .env 与配置。",
    "en": "Reply public or private to save .env and configuration together."
  },
  "cancelHint": {
    "zh-CN": "也可发 {command} 取消。",
    "en": "Send {command} to cancel."
  },
  "bindingBusy": {
    "zh-CN": "⚠️ 有进行中的扫码绑定，请先取消当前绑定流程",
    "en": "⚠️ A QR binding is in progress; cancel it before starting another"
  },
  "kindBusy": {
    "zh-CN": "⚠️ endpoint「{id}」等待公域/私域选择，请回复 public/private",
    "en": "⚠️ Endpoint “{id}” is waiting for public/private selection"
  },
  "endpointSaved": {
    "zh-CN": "✅ 已按 botKind={kind} 将 endpoint「{id}」写入 .env 与 {file}。\nintents: {intents}。\n⚠️ 需重启 zhin 后新 endpoint 才会生效。",
    "en": "✅ Saved endpoint “{id}” with botKind={kind} to .env and {file}.\nintents: {intents}.\n⚠️ Restart zhin to activate the new endpoint."
  },
  "existingFlow": {
    "zh-CN": "已有进行中的 QQ 机器人绑定或待确认的公域/私域选择，请先取消后再试",
    "en": "A QQ binding or public/private selection is already in progress; cancel it before trying again"
  },
  "scanLink": {
    "zh-CN": "请用手机 QQ 打开以下链接完成扫码绑定（二维码图片出站暂未支持，故发送链接）：\n{url}",
    "en": "Open this link in mobile QQ to scan and bind the bot:\n{url}"
  },
  "qrExpired": {
    "zh-CN": "二维码已过期，正在刷新，请扫描新链接…",
    "en": "The QR code expired. Refreshing; scan the new link…"
  },
  "noInteractiveKind": {
    "zh-CN": "\n（当前会话无法交互选择公/私域；私域请手动改配置。）",
    "en": "\n(This source cannot answer public/private selection. Edit the configuration manually for a private bot.)"
  },
  "scanned": {
    "zh-CN": "✅ 扫码成功！endpoint「{id}」。\n{prompt}",
    "en": "✅ QR binding succeeded for endpoint “{id}”.\n{prompt}"
  },
  "writeFailed": {
    "zh-CN": "绑定成功但写入配置失败：{error}",
    "en": "Binding succeeded but configuration could not be saved: {error}"
  },
  "bindingFailed": {
    "zh-CN": "❌ QQ 绑定失败：{error}",
    "en": "❌ QQ binding failed: {error}"
  },
  "cancelled": {
    "zh-CN": "已取消进行中的 QQ 绑定流程",
    "en": "The active QQ binding was cancelled"
  },
  "pendingCancelled": {
    "zh-CN": "已取消 endpoint「{name}」的绑定（尚未写入任何文件）",
    "en": "Binding for endpoint “{name}” cancelled; no files were written"
  },
  "noFlow": {
    "zh-CN": "当前没有进行中的 QQ 绑定流程",
    "en": "No QQ binding is in progress"
  },
  "kindUnrecognized": {
    "zh-CN": "未识别「{raw}」。{prompt}",
    "en": "Unrecognized answer “{raw}”. {prompt}"
  },
  "configFailed": {
    "zh-CN": "写入配置失败：{error}",
    "en": "Could not save configuration: {error}"
  }
});
