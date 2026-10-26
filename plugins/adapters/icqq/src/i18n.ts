import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "direct": {
    "zh-CN": "direct（直连 @icqqjs/icqq）",
    "en": "direct (@icqqjs/icqq)"
  },
  "addUsage": {
    "zh-CN": "用法：{command} <uin>（uin 为纯数字 QQ 号）",
    "en": "Usage: {command} <uin> (a numeric QQ account ID)"
  },
  "uinRequired": {
    "zh-CN": "请提供纯数字 QQ 号（uin）",
    "en": "Provide a numeric QQ account ID (uin)"
  },
  "uinInvalid": {
    "zh-CN": "icqq endpoint 名必须是纯数字 QQ 号（uin）",
    "en": "The ICQQ endpoint name must be a numeric QQ account ID (uin)"
  },
  "endpointAdded": {
    "zh-CN": "✅ endpoint「{id}」已追加到 {file} 的 plugins.icqq.endpoints。\n重启 zhin 后生效。",
    "en": "✅ Endpoint “{id}” added to plugins.icqq.endpoints in {file}.\nRestart zhin to apply."
  },
  "endpointAddFailed": {
    "zh-CN": "添加失败：{error}",
    "en": "Could not add the endpoint: {error}"
  },
  "loginQr": {
    "zh-CN": "扫码登录：请在手机 QQ 扫描二维码，完成后在 Console / 终端确认继续",
    "en": "Scan the QR code in mobile QQ, then confirm in Console or your terminal."
  },
  "loginSlider": {
    "zh-CN": "滑动验证：打开链接完成滑块，将返回的 ticket（可含 randstr）提交继续",
    "en": "Open the link, complete the slider challenge, and submit the returned ticket (with randstr if provided)."
  },
  "loginSms": {
    "zh-CN": "设备锁：已请求短信验证码，请提交短信验证码继续",
    "en": "Device verification: an SMS code was requested. Submit the code to continue."
  },
  "loginAuth": {
    "zh-CN": "身份验证：完成后在 Console / 终端确认继续",
    "en": "Complete identity verification, then confirm in Console or your terminal."
  },
  "loginOther": {
    "zh-CN": "登录辅助（{step}）",
    "en": "Login assistance ({step})"
  }
});
