import { createMessages } from 'zhin.js/i18n';

export const messages = createMessages({
  "missingUser": {
    "zh-CN": "❌ 无法获取当前用户信息",
    "en": "❌ Cannot resolve the current user."
  },
  "missingClientId": {
    "zh-CN": "❌ Endpoint 未配置 GitHub App 或 App 无 client_id，无法进行账号绑定",
    "en": "❌ This endpoint has no GitHub App client_id; account linking is unavailable."
  },
  "dbNotReady": {
    "zh-CN": "❌ 数据库未就绪",
    "en": "❌ Database is not ready."
  },
  "alreadyBound": {
    "zh-CN": "⚠️ 你已绑定 GitHub 账号: {login}\n如需重新绑定，请先解除绑定。",
    "en": "⚠️ GitHub account already linked: {login}\nUnlink it before linking another account."
  },
  "openDeviceLink": {
    "zh-CN": "🔗 请在浏览器中打开以下链接进行授权：",
    "en": "🔗 Open this link in a browser to authorize:"
  },
  "deviceCode": {
    "zh-CN": "📋 输入验证码: **{code}**",
    "en": "📋 Enter this code: **{code}**"
  },
  "waiting": {
    "zh-CN": "⏳ 等待授权中…（{minutes} 分钟内有效）",
    "en": "⏳ Waiting for authorization… (valid for {minutes} minutes)"
  },
  "bound": {
    "zh-CN": "✅ GitHub 账号绑定成功！\n👤 {login}",
    "en": "✅ GitHub account linked!\n👤 {login}"
  },
  "flowFailed": {
    "zh-CN": "❌ Device Flow 启动失败: {error}",
    "en": "❌ Could not start Device Flow: {error}"
  },
  "notBound": {
    "zh-CN": "📭 你尚未绑定 GitHub 账号",
    "en": "📭 No GitHub account is linked."
  },
  "unbound": {
    "zh-CN": "✅ 已解除 GitHub 账号绑定: {login}",
    "en": "✅ GitHub account unlinked: {login}"
  },
  "bindHint": {
    "zh-CN": "📭 你尚未绑定 GitHub 账号\n🔗 请先发起账号绑定。",
    "en": "📭 No GitHub account is linked.\n🔗 Start account linking first."
  },
  "account": {
    "zh-CN": "👤 已绑定 GitHub 账号: {login}\n📅 绑定时间: {date}",
    "en": "👤 Linked GitHub account: {login}\n📅 Linked at: {date}"
  },
  "expired": {
    "zh-CN": "⚠️ 已绑定账号 {login}，但 Token 已失效\n🔗 请先解除绑定，再重新绑定。",
    "en": "⚠️ Account {login} is linked, but its token has expired.\n🔗 Unlink it, then link it again."
  },
  "missingApp": {
    "zh-CN": "❌ Endpoint 未配置 GitHub App",
    "en": "❌ No GitHub App is configured for this endpoint."
  },
  "install": {
    "zh-CN": "🔗 请点击以下链接安装 GitHub App 到你的仓库：\n   {url}",
    "en": "🔗 Install the GitHub App in your repository using this link:\n   {url}"
  },
  "installed": {
    "zh-CN": "\n\n📋 当前已安装 ({count}):",
    "en": "\n\n📋 Current installations ({count}):"
  }
});
