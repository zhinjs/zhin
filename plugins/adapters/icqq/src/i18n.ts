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
  "loginDevice": {
    "zh-CN": "设备锁：打开链接，用手机 QQ 完成验证后提交 ok 继续登录；无法用链接验证时提交 sms，改用短信验证码",
    "en": "Device lock: open the link and finish verification in mobile QQ, then submit ok to continue. If the link does not work, submit sms to verify by SMS code instead."
  },
  "loginSms": {
    "zh-CN": "设备锁：短信验证码已发送{phone}，请提交收到的验证码",
    "en": "Device lock: an SMS code was sent{phone}. Submit the code you received."
  },
  "loginSmsSendFailed": {
    "zh-CN": "设备锁：短信验证码发送失败（{error}）。请打开链接用手机 QQ 完成验证后提交 ok，或稍后再提交 sms 重试",
    "en": "Device lock: the SMS code could not be sent ({error}). Open the link and verify in mobile QQ, then submit ok, or submit sms again later."
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
