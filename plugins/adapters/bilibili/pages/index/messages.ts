export type ReviewLocale = 'zh-CN' | 'en';

const english: Readonly<Record<string, string>> = {
  '评论审批': 'Comment review',
  'AI 写好的 B 站评论回复先停在这里，你点「发送」才会真的发出去。': 'AI-written Bilibili replies wait here. Nothing is posted until you press Send.',
  '加载中…': 'Loading…',
  'B 站适配器还没有启动。请先在配置里添加 bilibili 插件和至少一个账号。': 'The Bilibili adapter has not started. Add the bilibili plugin and at least one account to the config first.',
  '账号 {0}': 'Account {0}',
  '已登录': 'Signed in',
  '未登录': 'Not signed in',
  '登录已失效': 'Login expired',
  'Cookie 来自配置 / 环境变量': 'Cookie from config or environment',
  '扫码登录': 'QR login',
  '{0} 过期': 'Expires {0}',
  '未登录时只能读取公开评论，不能发送回复。': 'Without signing in, only public comments are read and replies cannot be posted.',
  '登录已失效，草稿都保留着。重新扫码登录后就能继续发送。': 'Login expired. Drafts are kept; sign in again to keep sending.',
  'Cookie 来自配置 / 环境变量且已失效：请更新环境变量，或去掉后在这里扫码登录。': 'The configured cookie has expired. Update the environment variables, or remove them and sign in here.',
  '扫码登录 B 站': 'Sign in with QR code',
  '重新扫码': 'Scan again',
  '退出登录': 'Sign out',
  '取消': 'Cancel',
  '用 B 站 App 扫一扫': 'Scan with the Bilibili app',
  '已扫码，请在手机上确认登录': 'Scanned. Confirm the login on your phone.',
  '二维码已过期': 'The QR code has expired',
  '登录成功': 'Signed in',
  '剩余 {0} 秒': '{0}s left',
  '登录凭据只保存在运行机器人的这台机器上，不会写进配置文件。': 'Credentials are stored only on the machine running the bot, never in the config file.',
  '触发了 B 站风控（错误码 {0}），已暂停轮询和发送。请到网页端确认账号状态，处理后重启。': 'Bilibili risk control was triggered (code {0}). Polling and sending are paused. Check the account on the website, then restart.',
  '出站已关闭（sendMode: off），草稿无法发送。': 'Outbound is off (sendMode: off); drafts cannot be sent.',
  '管理的视频': 'Watched videos',
  '还没有配置视频。要管理哪些视频请在配置的 videos 里填写 BV 号。': 'No videos configured. Add BV IDs under videos in the config.',
  '视频列表来自配置，要增删请改配置文件。': 'This list comes from the config; edit the config file to change it.',
  '待审回复': 'Replies awaiting review',
  '没有待审的回复。新的 AI 回复会自动出现在这里。': 'No replies awaiting review. New AI replies show up here automatically.',
  '草稿只存在内存里，重启会丢失。': 'Drafts are kept in memory only and are lost on restart.',
  '原评论': 'Original comment',
  '拟回复': 'Proposed reply',
  '上次发送时程序中断了，这条可能已经发出。请先到 B 站确认，避免重复回复。': 'The last send was interrupted, so this may already be posted. Check Bilibili first to avoid a duplicate.',
  '发送中…': 'Sending…',
  '发送': 'Send',
  '修改': 'Edit',
  '保存': 'Save',
  '丢弃': 'Discard',
  '确定丢弃这条回复？不会发送。': 'Discard this reply? It will not be posted.',
  '查看原评论': 'Open comment',
  '已发出': 'Posted',
  '查看': 'View',
  '已丢弃': 'Discarded',
  '已保存修改': 'Changes saved',
  '操作失败': 'Action failed',
  '没有操作权限': 'You do not have permission for this action',
  '{0} 字': '{0} chars',
  '刚刚': 'just now',
  '{0} 分钟前': '{0} min ago',
  '{0} 小时前': '{0} h ago',
  '{0} 天前': '{0} d ago',
  '刷新': 'Refresh',
};

export function detectLocale(): ReviewLocale {
  if (typeof document === 'undefined') return 'zh-CN';
  const lang = document.documentElement.lang || (typeof navigator !== 'undefined' ? navigator.language : '');
  return /^en\b/i.test(lang) ? 'en' : 'zh-CN';
}

export function text(locale: ReviewLocale, key: string, ...values: Array<string | number>): string {
  const template = locale === 'en' ? english[key] ?? key : key;
  return template.replace(/\{(\d+)\}/g, (_match, index: string) => String(values[Number(index)] ?? ''));
}
