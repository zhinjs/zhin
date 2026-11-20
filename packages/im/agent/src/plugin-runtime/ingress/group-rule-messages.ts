import { createMessages } from '@zhin.js/plugin-runtime';

/**
 * #1250: bilingual text of the group-rule card, notices and `rule …` replies. Command spellings are not
 * part of the catalog: they come from the group Endpoint's real command prefix.
 */
export const groupRuleMessages = createMessages({
  triggerAdvertising: { 'zh-CN': '发广告', en: 'advertising' },
  triggerAbuse: { 'zh-CN': '辱骂 / 人身攻击', en: 'abuse / personal attacks' },
  triggerFlood: { 'zh-CN': '刷屏复读', en: 'flooding / repeated messages' },
  hours: { 'zh-CN': '{count} 小时', en: '{count} h' },
  minutes: { 'zh-CN': '{count} 分钟', en: '{count} min' },
  seconds: { 'zh-CN': '{count} 秒', en: '{count} s' },
  stageRemind: { 'zh-CN': '提醒', en: 'reminder' },
  stageWarn: { 'zh-CN': '警告', en: 'warning' },
  stageMute: { 'zh-CN': '禁言 {duration}（自动执行）', en: 'mute for {duration} (automatic)' },
  stageKick: { 'zh-CN': '建议踢出（每次出审批卡，人批才踢）', en: 'suggest removal (an approval card each time; removed only when a person approves)' },
  stageSeparator: { 'zh-CN': ' → ', en: ' → ' },

  cardTitle: { 'zh-CN': '【群规草案 · 待审批】摘要 {code}', en: '[Group rule draft · pending approval] Code {code}' },
  cardTrigger: { 'zh-CN': '触发：{label}', en: 'Trigger: {label}' },
  cardStage: { 'zh-CN': '第 {index} 次：{stage}', en: 'Offense {index}: {stage}' },
  cardWindow: { 'zh-CN': '冷静期：{duration}内无再犯则重新计数', en: 'Cool-down: the count resets after {duration} without another offense' },
  cardExempt: { 'zh-CN': '豁免：{exempt}', en: 'Exempt: {exempt}' },
  exemptOwners: { 'zh-CN': '平台群主 / 管理员与 zhin owner', en: 'platform group owners / admins and the zhin owner' },
  exemptExtra: { 'zh-CN': '另加 {count} 人', en: '{count} more people' },
  exemptNone: { 'zh-CN': '无', en: 'none' },
  listSeparator: { 'zh-CN': '，', en: ', ' },
  cardContent: { 'zh-CN': '说明：{content}', en: 'Notes: {content}' },
  cardApprove: { 'zh-CN': '批准：{command}', en: 'Approve: {command}' },
  cardReject: { 'zh-CN': '驳回：{command}', en: 'Reject: {command}' },
  cardPrefixUnknown: { 'zh-CN': '（发送时加上本账号的命令前缀）', en: '(send it with this account\'s command prefix)' },
  cardFooter: {
    'zh-CN': '仅本群群主 / 管理员可审批；{duration}内未批自动作废。批准后禁言档自动执行，踢人仍每次审批。',
    en: 'Only this group\'s owner / admins can approve; it is voided if not approved within {duration}. Once approved, mutes run automatically; each removal still needs an approval.',
  },
  consoleApproved: { 'zh-CN': '【群规已生效】{summary}（Console 批准）', en: '[Group rule active] {summary} (approved in the Console)' },
  statusActive: { 'zh-CN': '生效中', en: 'active' },
  statusPending: { 'zh-CN': '待审批', en: 'pending' },
  summary: { 'zh-CN': '{code} {status} · {label}：{ladder}', en: '{code} {status} · {label}: {ladder}' },

  noticeRemind: { 'zh-CN': ' 提醒：本群不允许{label}，请注意（群规 {code}）。', en: ' Reminder: {label} is not allowed in this group (group rule {code}).' },
  noticeWarn: { 'zh-CN': ' 警告：再次{label}将按群规处理（群规 {code}）。', en: ' Warning: more {label} will be handled under the group rule (group rule {code}).' },
  noticeMute: { 'zh-CN': ' 因{label}已被禁言 {duration}（群规 {code}）。', en: ' Muted for {duration} for {label} (group rule {code}).' },
  noticeKick: {
    'zh-CN': ' 多次{label}，已提请群主 / 管理员审批是否移出本群（群规 {code}）。',
    en: ' Repeated {label}: the group owner / admins have been asked to approve a removal from this group (group rule {code}).',
  },
  botNotAdmin: {
    'zh-CN': '我在本群不是管理员（或无权管理该成员），群规 {code} 的禁言 / 踢人档暂时无法执行。请群主把我设为管理员，或发 {command} 停用该规则。',
    en: 'I am not an admin in this group (or cannot manage this member), so the mute / removal steps of group rule {code} cannot run. Ask the group owner to make me an admin, or send {command} to turn the rule off.',
  },

  groupOnly: { 'zh-CN': '群规命令只能在对应的群里使用。', en: 'Group rule commands only work in the rule\'s own group.' },
  unavailable: { 'zh-CN': '群规功能暂不可用。', en: 'Group rules are unavailable right now.' },
  listHeader: { 'zh-CN': '本群群规：', en: 'Group rules here:' },
  listEmpty: { 'zh-CN': '本群还没有生效或待审批的群规。', en: 'This group has no active or pending rules yet.' },
  approverOnly: { 'zh-CN': '只有本群群主或管理员可以审批 / 停用群规。', en: 'Only this group\'s owner or admins can approve or turn off group rules.' },
  disableMissing: { 'zh-CN': '本群没有匹配 {key} 的生效或待审批群规。', en: 'No active or pending group rule here matches {key}.' },
  disabled: { 'zh-CN': '已停用群规 {code}（{label}）。', en: 'Turned off group rule {code} ({label}).' },
  pendingMissing: {
    'zh-CN': '本群没有摘要为 {key} 的待审批群规（可能已处理、已过期或内容被改过）。',
    en: 'No pending group rule here has the code {key} (it may already be handled, expired or edited).',
  },
  rejected: { 'zh-CN': '已驳回群规 {key}。', en: 'Rejected group rule {key}.' },
  approved: { 'zh-CN': '群规 {key} 已生效：{label}，{ladder}{replaced}。', en: 'Group rule {key} is active: {label}, {ladder}{replaced}.' },
  replaced: { 'zh-CN': '，原同类规则已停用', en: '; the previous rule of this kind was turned off' },
  conflict: { 'zh-CN': '这条群规刚被别人处理过或已过期，请发 {command} 查看最新状态。', en: 'Someone just handled this group rule or it expired. Send {command} to see the latest state.' },
  failed: { 'zh-CN': '群规操作失败，未生效，请稍后再试。', en: 'The group rule operation failed and did not take effect. Try again later.' },
});
