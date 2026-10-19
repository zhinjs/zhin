/** Task-oriented entry points. Installation/configuration remain owned by their existing services. */
export interface PluginUseCase {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly packageName: string;
  readonly mode: 'administrator-task' | 'plugin-configuration' | 'conversation-command';
  readonly steps: readonly string[];
  readonly limitations: readonly string[];
}

export const pluginUseCases: readonly PluginUseCase[] = Object.freeze(([
  {
    id: 'reminder', title: '创建定时提醒', summary: '指定账号、会话与时间，创建可查看、暂停和取消的管理员提醒。',
    packageName: '@zhin.js/plugin-reminder', mode: 'administrator-task',
    steps: ['通过现有安装计划安装持久提醒插件，配置 Database Host 并应用。',
      '在 Console 任务中心选择当前已加载的提醒实例，检查当前版本与可用表单。',
      '选择精确投递账号及会话，填写含时区的时间和内容，确认未来发送的效果后创建。',
      '查看下次执行时间与实际结果；投递不确定时先核对目标会话，不盲目重建。'],
    limitations: ['Console 只管理管理员任务；聊天创建的提醒仍归原发送者。',
      '调度状态不证明平台在线或消息已展示；周期表示固定间隔，不能当作跨夏令时的本地日历计划。'],
  },
  {
    id: 'group-welcome', title: '配置新成员欢迎', summary: '为上报群成员增加事件的适配器配置欢迎文案。',
    packageName: '@zhin.js/plugin-group-suite', mode: 'plugin-configuration',
    steps: ['安装群运营套件并选择明确的插件实例；多实例时不能只凭包名修改。',
      '在该实例的配置表单填写 welcomeMessage，使用 {name} 和 {id} 表示新成员。',
      '检查作用范围，保存后应用；空文案关闭欢迎。',
      '等待真实且已授权的成员加入事件验证，查看投递结果，不能用启动成功代替。'],
    limitations: ['适配器须提供标准群成员增加通知，缺少该事件时不会发送。',
      '当前 welcomeMessage 作用于该实例收到通知的所有群；尚未提供精确范围配置，不能宣称已限制到单个群。'],
  },
  {
    id: 'keyword-reply', title: '配置群关键词回复', summary: '在指定群维护持久词库，并检查修改权限与匹配效果。',
    packageName: '@zhin.js/plugin-group-suite', mode: 'conversation-command',
    steps: ['安装群运营套件，配置持久 Database Host，在目标实例启用 keywordReply 并应用。',
      '由有权限的真实群成员在目标群使用 keyword-add、keyword-list 和 keyword-remove。',
      '使用该账号实际配置的前缀与命名空间，添加词条后在同一精确会话验证。'],
    limitations: ['Console 不伪造平台用户执行聊天命令；词库仍由插件按完整会话持久化。',
      '两个 Bot、父频道或话题不同的同名会话互不共享词库；临时词库不是持久保存。'],
  },
] satisfies PluginUseCase[]).map(item => Object.freeze({ ...item, steps: Object.freeze(item.steps), limitations: Object.freeze(item.limitations) })));

export function formatPluginUseCases(id?: string): string {
  const selected = id === undefined ? pluginUseCases : pluginUseCases.filter(item => item.id === id);
  if (!selected.length) throw new Error(`未知用途：${id}。运行 zhin use-cases 查看可用入口。`);
  if (id === undefined) return ['我想做什么？', ...selected.map(item => `  ${item.id}  ${item.title}\n    ${item.summary}`),
    '', '运行 zhin use-cases <用途> 查看步骤；本命令不安装、不改配置、不启动 Runtime，也不发送消息。'].join('\n');
  const item = selected[0]!;
  return [`${item.title} (${item.id})`, item.summary, '', `插件：${item.packageName}`,
    `安装预览：zhin install ${item.packageName} --dry-run`, '',
    ...item.steps.map((step, index) => `${index + 1}. ${step}`), '', '适用边界：',
    ...item.limitations.map(value => `- ${value}`)].join('\n');
}
