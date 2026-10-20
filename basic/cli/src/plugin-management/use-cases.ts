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
    id: 'rss-subscription', title: '订阅 RSS 新文章', summary: '在任务中心选择精确目标，创建独立管理员 RSS 订阅。',
    packageName: '@zhin.js/plugin-rss', mode: 'administrator-task',
    steps: ['通过现有安装计划安装 RSS 插件，配置持久 Database Host、Schedule Host 与支持精确目标的 Outbound Host，保存并应用。',
      '在 Console 任务中心选择当前已加载的 RSS 实例，核对账号、会话、父容器和线程。',
      '填写 HTTP(S) RSS / Atom 地址，阅读抓取和发送影响后创建；保存不会抓取源站或发送测试消息。',
      '等待实例轮询首次成功抓取建立基线；后续新文章才推送，可在任务中心暂停、编辑、恢复或取消。'],
    limitations: ['首次和暂停恢复后的首次成功抓取只建基线，不补发历史；每轮只检查源前 20 条，最多展示 maxItems 条，其余提示查看源站，不续轮补发。',
      '管理员订阅与聊天订阅独立；聊天 rss-list、rss-remove 和 rss-check 不管理或触发管理员任务。',
      '投递未确认时不自动重试或恢复，只能取消；先核实目标会话，确需继续时再新建。'],
  },
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
    id: 'personal-reminder', title: '在聊天里设置个人提醒', summary: '不启用 AI，补全时间和正文，确认后保存到原会话。',
    packageName: '@zhin.js/plugin-reminder', mode: 'conversation-command',
    steps: ['安装持久提醒插件，启用 Database Host 与 Schedule Feature，明确实例的 IANA timezone；默认 UTC。',
      '由真实发送者在原会话执行 remind create 十分钟后 喝水；只输入 remind create 时会逐项补问。',
      '使用实际前缀与插件命名空间；后续回答不加前缀，取消后再开始新流程。',
      '核对绝对时间、时区、正文与完整原会话，明确回复“确认”才保存；用 remind list 查看个人任务。'],
    limitations: ['仅支持有限中文自然时间与含 offset 的 ISO 时间，不猜发送者时区、裸时钟或夏令时重复时刻。',
      '聊天任务归真实发送者；Console 不代为执行，管理员任务仍使用单独入口。',
      '超时或取消不创建；投递或创建结果不确定时先核对，不自动重试。'],
  },
  {
    id: 'group-welcome', title: '配置新成员欢迎', summary: '为上报群成员增加事件的适配器配置欢迎文案。',
    packageName: '@zhin.js/plugin-group-suite', mode: 'plugin-configuration',
    steps: ['安装群运营套件并选择明确的插件实例；多实例时不能只凭包名修改。',
      '在该实例的配置表单填写 welcomeMessage，使用 {name} 和 {id} 表示新成员。',
      '在 welcomeConversations 选择精确账号与群；父容器和话题如有也须填写。核对范围后保存并应用。',
      '等待真实且已授权的成员加入事件验证，查看投递结果，不能用启动成功代替。'],
    limitations: ['适配器须提供标准群成员增加通知，缺少该事件时不会发送。',
      '省略 welcomeConversations 覆盖全部符合条件的群；空列表不欢迎任何会话。未填父容器或话题只匹配同样缺省的事件，不是通配。',
      '此范围只约束欢迎，不改变签到、词库、统计或命令 permit；空 welcomeMessage 仍关闭欢迎。'],
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
