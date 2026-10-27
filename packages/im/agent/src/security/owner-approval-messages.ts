import { createMessages } from '@zhin.js/plugin-runtime';

export const ownerApprovalMessages = createMessages({
  empty: { 'zh-CN': 'bash 永久放行: 否\n自定义正则放行: 无', en: 'Permanent bash approval: no\nCustom regex approvals: none' },
  status: { 'zh-CN': 'bash 永久放行: {enabled}\n自定义正则放行 ({count}):', en: 'Permanent bash approval: {enabled}\nCustom regex approvals ({count}):' },
  yes: { 'zh-CN': '是', en: 'yes' }, no: { 'zh-CN': '否', en: 'no' },
  denied: { 'zh-CN': '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。需在插件配置中设置 master/owner。', en: '⚠️ Only the Endpoint Owner can use this command in a private conversation. Set master/owner in the plugin configuration.' },
  always: { 'zh-CN': '✅ 已对 bash 永久放行 Owner 硬确认（本 Bot）。后续 bash 需确认时将不再弹窗。', en: '✅ Permanently approved bash for this Bot. Future bash requests will skip Owner confirmation.' },
  removed: { 'zh-CN': '✅ 已删除该放行规则。', en: '✅ Removed the approval rule.' },
  added: { 'zh-CN': '✅ 已添加规则 id={id}… ，匹配子命令时将不再要求 Owner 确认（仍受危险命令黑名单等约束）。', en: '✅ Added rule id={id}… Matching subcommands will skip Owner confirmation; dangerous-command restrictions still apply.' },
  notAlways: { 'zh-CN': '⚠️ 当前未对 bash 设置永久放行。', en: '⚠️ bash does not have permanent approval.' },
  revoked: { 'zh-CN': '✅ 已撤销 bash 永久放行（正则规则仍保留，可用 {command} list 查看）。', en: '✅ Revoked permanent bash approval. Regex rules remain; view them with {command} list.' },
  unknown: { 'zh-CN': '⚠️ 无法解析指令。', en: '⚠️ Could not parse the command.' },
  usage: { 'zh-CN': '用法（bash / icqq）：\n  {command} always bash     — 永久跳过 bash 的 Owner 硬确认\n  {command} rule <正则>   — 为敏感 icqq 命令增加放行规则（匹配整段子命令）\n  {command} list           — 列出永久放行与规则 id\n  {command} revoke rule <id> — 删除一条规则（id 可用 list 前 8 位）\n  {command} revoke         — 撤销 bash 永久放行（不删规则）', en: 'Usage (bash / icqq):\n  {command} always bash     — permanently skip Owner confirmation for bash\n  {command} rule <regex>    — approve matching sensitive icqq subcommands\n  {command} list            — list permanent approval and rule IDs\n  {command} revoke rule <id> — remove a rule (the first 8 ID characters are accepted)\n  {command} revoke          — revoke permanent bash approval, keeping regex rules' },
  emptyPattern: { 'zh-CN': '正则不能为空。', en: 'The regular expression cannot be empty.' },
  invalidPattern: { 'zh-CN': '无效正则: {error}', en: 'Invalid regular expression: {error}' },
  emptyId: { 'zh-CN': '请提供规则 id。', en: 'Provide a rule ID.' },
  noRules: { 'zh-CN': '当前无自定义规则。', en: 'There are no custom rules.' },
  missingId: { 'zh-CN': '未找到 id 前缀或全名为「{id}」的规则。', en: 'No rule matches the ID or prefix "{id}".' },
});
