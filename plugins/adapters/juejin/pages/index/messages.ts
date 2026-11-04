export type ReviewLocale = 'zh-CN' | 'en';

const english: Readonly<Record<string, string>> = {
  '掘金评论审批': 'Juejin comment review',
  'AI 写好的掘金评论回复先停在这里，你点「发送」才会真的发出去。': 'AI-written Juejin replies wait here. Nothing is posted until you press Send.',
  '加载中…': 'Loading…',
  '掘金适配器还没有启动。请先在配置里添加 juejin 插件和至少一个账号。': 'The Juejin adapter has not started. Add the juejin plugin and at least one account to the config first.',
  '账号 {0}': 'Account {0}',
  '已登录': 'Signed in',
  '未登录': 'Not signed in',
  '登录已失效': 'Login expired',
  'Cookie 来自配置 / 环境变量': 'Cookie from config or environment',
  '未登录时只能读取公开评论，不能发送回复。请用 JUEJIN_COOKIE 环境变量注入 Cookie。': 'Without signing in, only public comments are read and replies cannot be posted. Inject the cookie with the JUEJIN_COOKIE environment variable.',
  'Cookie 已失效，草稿都保留着。更新 JUEJIN_COOKIE 后重启就能继续发送。': 'The cookie has expired. Drafts are kept; update JUEJIN_COOKIE and restart to keep sending.',
  '重新检查登录': 'Check login again',
  'Cookie 只来自配置 / 环境变量，不会经过这个页面，也不会写进数据目录。': 'The cookie only comes from config or environment; it never passes through this page or the data directory.',
  '触发了掘金风控或账号异常（错误码 {0}），已暂停轮询和发送。请到网页端确认账号状态，处理后重启。': 'Juejin risk control or an account problem was detected (code {0}). Polling and sending are paused. Check the account on the website, then restart.',
  '出站已关闭（sendMode: off），草稿无法发送。': 'Outbound is off (sendMode: off); drafts cannot be sent.',
  '管理的文章': 'Watched articles',
  '还没有配置文章。要管理哪些文章请在配置的 articles 里填写文章 id 或链接。': 'No articles configured. Add article IDs or links under articles in the config.',
  '文章列表来自配置，要增删请改配置文件。': 'This list comes from the config; edit the config file to change it.',
  '待审回复': 'Replies awaiting review',
  '没有待审的回复。新的 AI 回复会自动出现在这里。': 'No replies awaiting review. New AI replies show up here automatically.',
  '草稿只存在内存里，重启会丢失。': 'Drafts are kept in memory only and are lost on restart.',
  '原评论': 'Original comment',
  '拟回复': 'Proposed reply',
  '上次发送的结果未知，这条可能已经发出。请先到掘金文章评论区确认，避免重复回复。': 'The last send outcome is unknown, so this may already be posted. Check the Juejin article comments first to avoid a duplicate.',
  '发送中…': 'Sending…',
  '发送': 'Send',
  '修改': 'Edit',
  '保存': 'Save',
  '取消': 'Cancel',
  '丢弃': 'Discard',
  '确定丢弃这条回复？不会发送。': 'Discard this reply? It will not be posted.',
  '打开文章': 'Open article',
  '已发出': 'Posted',
  '查看': 'View',
  '已丢弃': 'Discarded',
  '已保存修改': 'Changes saved',
  '操作失败': 'Action failed',
  '{0} 字': '{0} chars',
  '刚刚': 'just now',
  '{0} 分钟前': '{0} min ago',
  '{0} 小时前': '{0} h ago',
  '{0} 天前': '{0} d ago',
  '刷新': 'Refresh',
  '文章 {0}': 'Article {0}',
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
