import { createMessages } from '@zhin.js/plugin-runtime';

/**
 * #1250: bilingual text of the IM approval cards and of the `approve` / `deny` replies. The command
 * spellings are not part of the catalog: they come from the recipient's real command prefix.
 */
export const toolApprovalImMessages = createMessages({
  // Dangerous-tool card
  cardTitle: { 'zh-CN': '【危险工具审批】{tool}{category}', en: '[Dangerous tool approval] {tool}{category}' },
  cardCategory: { 'zh-CN': '（{label}）', en: ' ({label})' },
  cardConversation: { 'zh-CN': '会话：{conversation}', en: 'Conversation: {conversation}' },
  cardRequester: { 'zh-CN': '发起人：{id}', en: 'Requested by: {id}' },
  cardArgs: { 'zh-CN': '参数：{args}', en: 'Arguments: {args}' },
  cardId: { 'zh-CN': '审批卡片：{id}', en: 'Approval card: {id}' },
  cardExpiryDeny: { 'zh-CN': '过期时间：{time}（超时自动拒绝）', en: 'Expires: {time} (denied automatically on timeout)' },
  cardApprove: { 'zh-CN': '批准：{command}', en: 'Approve: {command}' },
  cardDeny: { 'zh-CN': '拒绝：{command}', en: 'Deny: {command}' },
  cardPrefixUnknown: {
    'zh-CN': '（发送时加上本账号的命令前缀）',
    en: '(send it with this account\'s command prefix)',
  },
  cardFooterGroup: {
    'zh-CN': '仅名单内审批人可处理；一次批准只放行这一次同参数调用，也可在 Console 处理。',
    en: 'Only listed approvers can answer. One approval allows only this one call with these arguments; you can also answer in the Console.',
  },
  cardFooterDm: {
    'zh-CN': '一次批准只放行这一次同参数调用，也可在 Console 处理。',
    en: 'One approval allows only this one call with these arguments; you can also answer in the Console.',
  },
  categoryMember: { 'zh-CN': '成员管理', en: 'member management' },
  categoryPublish: { 'zh-CN': '内容发布', en: 'publishing' },
  categoryFunds: { 'zh-CN': '资金', en: 'funds' },
  categoryIdentity: { 'zh-CN': '身份', en: 'identity' },
  categorySelf: { 'zh-CN': '改宿主配置', en: 'host configuration' },

  // Self-change card
  selfTitle: { 'zh-CN': '【变更审批】{summary}', en: '[Change approval] {summary}' },
  selfChange: { 'zh-CN': '变更：{id}', en: 'Change: {id}' },
  selfOrigin: { 'zh-CN': '发起：{conversation}', en: 'Started in: {conversation}' },
  selfOriginBy: { 'zh-CN': '发起：{conversation}（{requester}）', en: 'Started in: {conversation} ({requester})' },
  selfFiles: { 'zh-CN': '文件（{count}）：', en: 'Files ({count}):' },
  selfFile: { 'zh-CN': '  {kind} {path}（+{added} -{removed}）', en: '  {kind} {path} (+{added} -{removed})' },
  selfMoreFiles: { 'zh-CN': '  …另 {count} 个文件', en: '  …{count} more files' },
  selfConfig: { 'zh-CN': '配置：{paths}', en: 'Config: {paths}' },
  selfImpact: { 'zh-CN': '影响：{impact}', en: 'Impact: {impact}' },
  selfImpactDetail: { 'zh-CN': '影响：{impact}（{detail}）', en: 'Impact: {impact} ({detail})' },
  impactNone: { 'zh-CN': '无需重载', en: 'no reload needed' },
  impactGeneration: { 'zh-CN': '热重载', en: 'hot reload' },
  impactProcess: { 'zh-CN': '需要重启', en: 'restart required' },
  impactUnknown: { 'zh-CN': '未知', en: 'unknown' },
  impactEstimated: { 'zh-CN': '（估计）', en: ' (estimated)' },
  selfTrial: { 'zh-CN': '试跑：{verdict}', en: 'Trial run: {verdict}' },
  selfTrialSkipped: { 'zh-CN': '试跑：{verdict}；跳过：{names}{more}', en: 'Trial run: {verdict}; skipped: {names}{more}' },
  selfTrialMore: { 'zh-CN': '，…另 {count} 项（见 Console）', en: ', …{count} more (see the Console)' },
  trialPassed: { 'zh-CN': '通过', en: 'passed' },
  selfExpiry: { 'zh-CN': '过期时间：{time}（超时自动作废）', en: 'Expires: {time} (voided automatically on timeout)' },
  selfReject: { 'zh-CN': '驳回：{command}', en: 'Reject: {command}' },
  selfFooter: {
    'zh-CN': '批准只对这一版内容有效；只能在私聊或 Console 处理，不能在群里结算。',
    en: 'An approval covers only this exact version. Answer in a private chat or the Console; a group cannot settle it.',
  },
  diffUnavailable: { 'zh-CN': '差异摘录：不可用，完整内容见 Console。', en: 'Diff excerpt: unavailable; see the Console for the full change.' },
  diffEmpty: { 'zh-CN': '差异摘录：无文件正文改动。', en: 'Diff excerpt: no file body changes.' },
  diffHeader: { 'zh-CN': '差异摘录：', en: 'Diff excerpt:' },
  diffTruncated: { 'zh-CN': '…（摘录已截断）完整内容见 Console。', en: '… (excerpt truncated) See the Console for the full change.' },
  diffComplete: { 'zh-CN': '（以上为全部改动）', en: '(that is the whole change)' },
  blindWarning: {
    'zh-CN': '⚠️ 未看完整正文请去 Console 查看后再批准，不要盲批。',
    en: '⚠️ If you have not read the full change, review it in the Console before approving. Do not approve blind.',
  },

  // `approve` / `deny` replies
  selfPrivateOnly: {
    'zh-CN': '变更审批只能在与 Bot 的私聊中处理，群内消息不会结算审批卡片。',
    en: 'Change approvals can only be answered in a private chat with the Bot; messages in a group do not settle approval cards.',
  },
  channelOff: {
    'zh-CN': 'IM 审批通道未开启，请在 Console 处理该审批卡片。',
    en: 'The IM approval channel is off. Answer this approval card in the Console.',
  },
  privateOrGroupOnly: {
    'zh-CN': '危险工具审批只能在私聊或指定的审批群中处理，本会话的消息不会结算审批卡片。',
    en: 'Dangerous-tool approvals can only be answered in a private chat or the configured approver group; messages here do not settle approval cards.',
  },
  privateOnly: {
    'zh-CN': '危险工具审批只能在与 Bot 的私聊中处理，群内消息不会结算审批卡片。',
    en: 'Dangerous-tool approvals can only be answered in a private chat with the Bot; messages in a group do not settle approval cards.',
  },
  notApprover: {
    'zh-CN': '你不在危险工具审批人名单中，无法处理审批卡片。',
    en: 'You are not on the dangerous-tool approver list, so you cannot answer approval cards.',
  },
  notFound: { 'zh-CN': '未找到审批卡片 {id}。', en: 'Approval card {id} was not found.' },
  originConversation: {
    'zh-CN': '不能在触发该操作的会话中处理审批卡片。',
    en: 'An approval card cannot be answered in the conversation that triggered it.',
  },
  alreadyDecided: { 'zh-CN': '审批卡片 {id} 已{status}，无需重复处理。', en: 'Approval card {id} was already {status}; nothing to do.' },
  statusApproved: { 'zh-CN': '批准', en: 'approved' },
  statusConsumed: { 'zh-CN': '批准并执行', en: 'approved and executed' },
  statusDenied: { 'zh-CN': '拒绝', en: 'denied' },
  statusExpired: { 'zh-CN': '过期', en: 'expired' },
  statusOther: { 'zh-CN': '处理', en: 'handled' },
  selfApproved: { 'zh-CN': '已批准变更 {change}（{id}）。', en: 'Approved change {change} ({id}).' },
  selfRejected: { 'zh-CN': '已驳回变更 {change}（{id}）。', en: 'Rejected change {change} ({id}).' },
  approved: {
    'zh-CN': '已批准 {id}（{tool}），仅对这一次同参数调用生效。',
    en: 'Approved {id} ({tool}). It applies only to this one call with these arguments.',
  },
  denied: { 'zh-CN': '已拒绝 {id}（{tool}）。', en: 'Denied {id} ({tool}).' },
});
