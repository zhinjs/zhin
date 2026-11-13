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
  "loginConnecting": {
    "zh-CN": "正在连接 QQ…",
    "en": "Connecting to QQ…"
  },
  "loginReconnecting": {
    "zh-CN": "正在重新登录…",
    "en": "Logging in again…"
  },
  "loginRetryScheduled": {
    "zh-CN": "{reason}，{seconds} 秒后自动重新登录（第 {attempt} 次）",
    "en": "{reason}; logging in again automatically in {seconds}s (attempt {attempt})"
  },
  "loginReasonKickoff": {
    "zh-CN": "账号被踢下线",
    "en": "The account was signed out"
  },
  "loginReasonNetwork": {
    "zh-CN": "网络或服务器出错",
    "en": "Network or server error"
  },
  "loginReasonFailed": {
    "zh-CN": "登录没有完成",
    "en": "The login did not finish"
  },
  "loginSubmit": {
    "zh-CN": "提交",
    "en": "Submit"
  },
  "loginVerifying": {
    "zh-CN": "正在登录…",
    "en": "Logging in…"
  },
  "loginVerifyingSlider": {
    "zh-CN": "正在提交滑块结果…",
    "en": "Submitting the slider result…"
  },
  "loginVerifyingDevice": {
    "zh-CN": "正在确认设备验证…",
    "en": "Checking the device verification…"
  },
  "loginVerifyingSms": {
    "zh-CN": "正在校验短信验证码…",
    "en": "Checking the SMS code…"
  },
  "loginVerifyingAuth": {
    "zh-CN": "正在继续登录…",
    "en": "Continuing the login…"
  },
  "loginSdkCallFailed": {
    "zh-CN": "调用 QQ 登录接口失败：{error}",
    "en": "The QQ login call failed: {error}"
  },
  "qrTitle": {
    "zh-CN": "扫码登录",
    "en": "Scan to log in"
  },
  "qrShort": {
    "zh-CN": "用手机 QQ 扫描二维码，然后在手机上确认登录。",
    "en": "Scan the QR code with mobile QQ, then confirm the login on your phone."
  },
  "qrStepScan": {
    "zh-CN": "用手机 QQ 扫码",
    "en": "Scan the QR code with mobile QQ"
  },
  "qrStepConfirm": {
    "zh-CN": "在手机上确认登录",
    "en": "Confirm the login on your phone"
  },
  "qrStepContinue": {
    "zh-CN": "确认后会自动继续；没有继续时点「我已确认登录」",
    "en": "It continues by itself after you confirm; if it does not, choose “I confirmed the login”"
  },
  "qrConfirm": {
    "zh-CN": "我已确认登录",
    "en": "I confirmed the login"
  },
  "qrScanned": {
    "zh-CN": "已扫码，请在手机上确认登录",
    "en": "Scanned. Confirm the login on your phone"
  },
  "qrNotScanned": {
    "zh-CN": "还没有扫码，请先用手机 QQ 扫码",
    "en": "Not scanned yet. Scan the QR code with mobile QQ first"
  },
  "qrExpired": {
    "zh-CN": "二维码已过期",
    "en": "The QR code expired"
  },
  "qrRefreshing": {
    "zh-CN": "正在换一张二维码…",
    "en": "Getting a new QR code…"
  },
  "qrExpiredRefreshing": {
    "zh-CN": "二维码已过期，已自动换一张",
    "en": "The QR code expired; a new one was issued"
  },
  "sliderTitle": {
    "zh-CN": "滑块验证",
    "en": "Slider verification"
  },
  "sliderShort": {
    "zh-CN": "完成腾讯滑块验证。在 Console 可以打开验证码辅助页，完成后自动提交，不需要开发者工具。",
    "en": "Complete the Tencent slider. In Console you can open the captcha helper page, which submits the result for you without developer tools."
  },
  "sliderStepOpen": {
    "zh-CN": "打开滑块验证链接",
    "en": "Open the slider link"
  },
  "sliderStepDevtools": {
    "zh-CN": "按 F12 打开开发者工具的「网络」面板，再拖动滑块完成拼图",
    "en": "Press F12, open the Network panel of the developer tools, then complete the slider"
  },
  "sliderStepCopy": {
    "zh-CN": "在 cap_union_new_verify 请求的响应里复制 ticket；也可以粘贴整段响应或带 ticket 的链接，会自动提取",
    "en": "Copy ticket from the cap_union_new_verify response. You can also paste the whole response or a link containing ticket; it is extracted for you"
  },
  "sliderLink": {
    "zh-CN": "打开滑块验证",
    "en": "Open the slider"
  },
  "sliderInput": {
    "zh-CN": "ticket",
    "en": "Ticket"
  },
  "sliderRandstrMissing": {
    "zh-CN": "这个滑块需要 ticket 和 randstr：请粘贴整段响应 JSON，或按 ticket,randstr 提交",
    "en": "This slider needs both ticket and randstr: paste the whole response JSON, or submit ticket,randstr"
  },
  "deviceTitle": {
    "zh-CN": "设备锁验证",
    "en": "Device lock verification"
  },
  "deviceShort": {
    "zh-CN": "这台设备需要用绑定的手机确认后才能登录。",
    "en": "This device has to be confirmed with the account's phone before it can log in."
  },
  "deviceStepScan": {
    "zh-CN": "用手机 QQ 扫描验证链接的二维码，或在手机上打开链接",
    "en": "Scan the verification link's QR code with mobile QQ, or open the link on your phone"
  },
  "deviceStepNoLink": {
    "zh-CN": "打开手机 QQ，按提示完成设备验证",
    "en": "Open mobile QQ and follow the prompt to verify this device"
  },
  "deviceStepVerify": {
    "zh-CN": "按手机上的提示完成验证",
    "en": "Follow the prompts on your phone"
  },
  "deviceStepContinue": {
    "zh-CN": "完成后点「我已在手机完成验证」",
    "en": "Then choose “I verified on my phone”"
  },
  "deviceStepSms": {
    "zh-CN": "无法用链接验证时，可以点「改用短信验证码」",
    "en": "If the link does not work, choose “Use an SMS code instead”"
  },
  "deviceLink": {
    "zh-CN": "设备锁验证链接",
    "en": "Device lock verification link"
  },
  "deviceContinue": {
    "zh-CN": "我已在手机完成验证",
    "en": "I verified on my phone"
  },
  "deviceSms": {
    "zh-CN": "改用短信验证码",
    "en": "Use an SMS code instead"
  },
  "smsSendFailed": {
    "zh-CN": "短信验证码发送失败：{error}",
    "en": "The SMS code could not be sent: {error}"
  },
  "smsTitle": {
    "zh-CN": "短信验证码",
    "en": "SMS code"
  },
  "smsShort": {
    "zh-CN": "验证码已发送到 {phone}，请输入收到的 6 位验证码。",
    "en": "A code was sent to {phone}. Enter the 6-digit code you received."
  },
  "smsPhoneFallback": {
    "zh-CN": "密保手机",
    "en": "the account's phone"
  },
  "smsInput": {
    "zh-CN": "验证码",
    "en": "Code"
  },
  "smsHint": {
    "zh-CN": "请输入 6 位数字",
    "en": "Enter 6 digits"
  },
  "smsResend": {
    "zh-CN": "重新发送",
    "en": "Send again"
  },
  "smsResent": {
    "zh-CN": "已重新发送短信验证码",
    "en": "The SMS code was sent again"
  },
  "authTitle": {
    "zh-CN": "身份验证",
    "en": "Identity verification"
  },
  "authShort": {
    "zh-CN": "QQ 要求在验证页确认这台设备，需要把设备信息带到验证页。按下面的步骤做。",
    "en": "QQ asks you to confirm this device on its verification page, which needs this device's information. Follow the steps below."
  },
  "authStepCopy": {
    "zh-CN": "复制设备 JSON",
    "en": "Copy the device JSON"
  },
  "authStepOpen": {
    "zh-CN": "打开验证链接，进入发送验证码的页面",
    "en": "Open the verification link and go to the page that sends the code"
  },
  "authStepScript": {
    "zh-CN": "在该页按 F12 打开开发者工具的 Console 运行辅助脚本（也可以把它拖到书签栏后点击），按提示粘贴设备 JSON，再完成验证",
    "en": "On that page press F12 and run the helper script in the developer tools Console (or drag it to the bookmarks bar and click it), paste the device JSON when asked, then finish the verification"
  },
  "authStepVerify": {
    "zh-CN": "按页面提示完成验证",
    "en": "Follow the page to finish the verification"
  },
  "authStepContinue": {
    "zh-CN": "完成后点「已完成，继续登录」",
    "en": "Then choose “Done, continue logging in”"
  },
  "authWarning": {
    "zh-CN": "不要把设备 JSON 粘贴到其他网站或发给他人",
    "en": "Never paste the device JSON on other sites or send it to anyone"
  },
  "authJson": {
    "zh-CN": "设备 JSON",
    "en": "Device JSON"
  },
  "authScript": {
    "zh-CN": "辅助脚本",
    "en": "Helper script"
  },
  "authScriptCollapsed": {
    "zh-CN": "展开辅助脚本",
    "en": "Show the helper script"
  },
  "authLink": {
    "zh-CN": "验证链接",
    "en": "Verification link"
  },
  "authContinue": {
    "zh-CN": "已完成，继续登录",
    "en": "Done, continue logging in"
  },
  "loginErrorCodeInvalid": {
    "zh-CN": "验证码或 ticket 不正确",
    "en": "The code or ticket is not correct"
  },
  "loginErrorRateLimited": {
    "zh-CN": "操作太频繁，请稍后再试",
    "en": "Too many attempts. Try again later"
  },
  "loginErrorExpired": {
    "zh-CN": "登录验证已过期，请重新登录",
    "en": "The login verification expired. Log in again"
  },
  "loginErrorRisk": {
    "zh-CN": "QQ 拒绝了这次登录（账号或设备受限）",
    "en": "QQ refused this login (the account or device is restricted)"
  },
  "loginErrorCredential": {
    "zh-CN": "密码或登录凭据无效",
    "en": "The password or login credential is not valid"
  },
  "loginErrorNetwork": {
    "zh-CN": "网络或 QQ 服务器出错",
    "en": "Network or QQ server error"
  },
  "loginErrorUnknown": {
    "zh-CN": "登录失败",
    "en": "Login failed"
  }
});
