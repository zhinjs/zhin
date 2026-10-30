/** Adapter Console 页面文案；键是中文原文，英文只做界面翻译。 */
export type AdapterConsoleLocale = 'zh-CN' | 'en';

const EN: Record<string, string> = {
  '账号': 'Accounts',
  '操作': 'Operation',
  '替换': 'Replace',
  '{0}失败': '{0} failed',
  '关闭未完成': 'Closure incomplete',
  '账号清单已变化，请取消编辑后重新打开。': 'The account list has changed. Cancel and reopen the editor.',
  '添加账号': 'Add account',
  '管理 {0} 的账号与登录。': 'Manage {0} accounts and logins.',
  '编辑': 'Edit',
  '保存': 'Save',
  '启动': 'Start',
  '停止': 'Stop',
  '正在关闭': 'Closing',
  '操作进行中': 'Operation in progress',
  '执行失败': 'Execution failed',
  '已完成': 'Completed',
  '编辑账号': 'Edit account',
  '已保存。': 'Saved.',
  '已保存，请手动启动账号。': 'Saved. Start the account when ready.',
  '已保存，操作进行中。': 'Saved. Operation in progress.',
  '查看 {0} 的连接与账号配置。': 'View {0} connections and account configuration.',
  '还没有运行中的连接。': 'There are no running connections.',
  '未运行': 'Not running',
  '当前环境只能查看账号配置。': 'Account configuration is read-only in this environment.',
  '配置已保存，执行失败。请查看账号状态。': 'Configuration saved, but execution failed. Check the account status.',
  '首次迁移需要管理员确认。': 'An administrator must confirm the initial migration.',
  '首次修改前需迁移以下账号，保留身份和历史。': 'Migrate these accounts before the first change. Identity and history will be preserved.',
  '确认迁移': 'Confirm migration',
  '确认迁移以下账号并执行本次操作？身份和历史将保留。': 'Migrate these accounts and perform this operation? Identity and history will be preserved.',
  '请刷新账号清单后再操作。': 'Refresh the account list before continuing.',
  '账号清单已变化，请刷新后重新操作。': 'The account list has changed. Refresh before continuing.',
  '没有此操作的权限。': 'You do not have permission for this operation.',
  '提交结果尚未确认，请刷新核实，不要重复提交。': 'The commit outcome is unknown. Refresh to verify before submitting again.',
  '操作未能完成，请刷新账号清单。': 'The operation could not be completed. Refresh the account list.',
  '输入无效，请检查账号字段。': 'Invalid input. Check the account fields.',
  '最近操作：{0}': 'Latest operation: {0}',
  '删除账号「{0}」？账号将关闭，历史保留。': 'Remove account "{0}"? The account will close; history will be retained.',
  '替换账号「{0}」？旧账号将关闭，历史保留；新账号不继承会话和设置，保存后需手动启动。': 'Replace account "{0}"? The old account will close and its history will be retained. The new account will not inherit sessions or settings and must be started manually.',
  '适配器 Console': 'Adapter Console',
  '管理 {0} 的连接、登录待办和 endpoint 配置。': 'Manage {0} connections, pending logins and endpoint configuration.',
  '文档': 'Docs',
  '刷新': 'Refresh',
  '加载中…': 'Loading…',
  '加载失败：{0}': 'Failed to load: {0}',
  '运行中的连接': 'Running connections',
  '还没有运行中的连接。请检查配置并重启、或等待适配器启动。': 'No running connections yet. Check the configuration and restart, or wait for the adapter to start.',
  '测试连接': 'Test connection',
  '在线': 'Online',
  '离线': 'Offline',
  '等待登录': 'Waiting for login',
  '重连中': 'Reconnecting',
  '连接中': 'Connecting',
  '已停止': 'Stopped',
  '未知': 'Unknown',
  '配置中的 endpoint': 'Configured endpoints',
  '配置里还没有 endpoint。': 'No endpoint is configured yet.',
  '重启后生效': 'Restart required',
  '删除': 'Remove',
  '确定删除 endpoint「{0}」？配置会从 zhin.config.yml 移除。': 'Remove endpoint "{0}"? It will be deleted from zhin.config.yml.',
  '已删除': 'Removed',
  '添加 endpoint': 'Add endpoint',
  'id': 'ID',
  '凭据会写入 .env，配置里只保留引用。': 'Credentials are written to .env; the config only keeps a reference.',
  '添加': 'Add',
  '请填写 {0}': 'Please fill in {0}',
  'id 格式不正确': 'Invalid ID format',
  '已添加，重启或热重载后生效。': 'Added. Restart or wait for hot reload to apply.',
  '登录待办': 'Pending logins',
  '完成': 'Finish',
  '取消': 'Cancel',
  '提交': 'Submit',
  '已扫码，继续': 'Scanned, continue',
  '二维码': 'QR code',
  '滑块验证': 'Slider challenge',
  '短信验证': 'SMS code',
  '设备确认': 'Device confirmation',
  '登录确认': 'Login confirmation',
  '其他验证': 'Other verification',
  '剩余 {0} 秒': '{0}s left',
  '操作失败': 'Operation failed',
  '平台操作': 'Platform actions',
  '平台状态': 'Platform status',
  '未配置': 'Not configured',
  '运行中': 'Running',
  '模式：{0}': 'Mode: {0}',
  '连接测试：{0}（{1} ms）': 'Connection test: {0} ({1} ms)',
  '请输入 {0}': 'Enter {0}',
  '选择…': 'Select…',
  '确认': 'Confirm',
  '暂无': 'None',
  '此页面由适配器提供；敏感凭据不会展示。': 'This page is provided by the adapter; secrets are never shown.',
  '写入配置后需要重启进程或等待热重载。': 'Configuration changes need a restart or hot reload.',
  '配置存储不可用：当前环境只能查看，不能增删 endpoint。': 'Configuration storage is unavailable: this environment is read-only.',
  '正在解析插件…': 'Resolving plugin…',
  '找不到页面所属插件。': 'Could not resolve the plugin that owns this page.',
  '启停操作不可用。': 'Lifecycle actions are unavailable.',
  '已提交。': 'Submitted.',
};

export function adapterConsoleText(
  locale: AdapterConsoleLocale,
  zh: string,
  ...values: (string | number)[]
): string {
  const template = locale === 'en' ? (EN[zh] ?? zh) : zh;
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}

export function adapterConsoleLocale(): AdapterConsoleLocale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language?.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en';
}

/** 按语言挑选服务端返回的 i18n 文案；缺失时保留原文。 */
export function pickI18n(
  locale: AdapterConsoleLocale,
  original: string | undefined,
  i18n: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (!original) return original;
  if (locale === 'en' && i18n?.en) return i18n.en;
  return original;
}
