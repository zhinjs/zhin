import { createMessages } from '@zhin.js/plugin-runtime';

export const permissionMessages = createMessages({
  uncheckedPlatform: { 'zh-CN': '平台权限 checker 未执行，不能据此判断权限', en: 'The platform permission checker was not executed; authorization cannot be inferred' },
  invalidPlatform: { 'zh-CN': '平台权限规则缺少有效的适配器或权限名称', en: 'The platform permission rule lacks a valid adapter or permission name' },
  unknownRule: { 'zh-CN': '未知或自定义规则未执行；命令声明仅支持 builtin 与 platform DSL', en: 'Unknown or custom rules were not executed; command declarations support only builtin and platform DSL rules' },
  adapter: { 'zh-CN': '按完整 adapter、路径末段或末段以“值-”开头匹配；星号不表示任意适配器', en: 'Matches the complete adapter, its final path segment, or a final segment starting with value-; an asterisk does not mean any adapter' },
  group: { 'zh-CN': '要求群聊，按群 ID 匹配；空值或星号不限群 ID', en: 'Requires a group conversation and matches the group ID; an empty value or asterisk allows any group ID' },
  private: { 'zh-CN': '要求私聊，按会话 ID 匹配；空值或星号不限会话 ID', en: 'Requires a private conversation and matches its ID; an empty value or asterisk allows any conversation ID' },
  channel: { 'zh-CN': '要求频道，按频道 ID 匹配；空值或星号不限频道 ID', en: 'Requires a channel conversation and matches the channel ID; an empty value or asterisk allows any channel ID' },
  user: { 'zh-CN': '按发送者 ID 精确匹配', en: 'Matches the sender ID exactly' },
  role: { 'zh-CN': '按角色精确匹配；仅 master 隐含 trusted，不隐含 admin', en: 'Matches roles exactly; master also implies trusted, but does not imply admin' },
  missingRole: { 'zh-CN': '未提供假设角色，无法判断角色条件', en: 'No hypothetical roles were provided, so the role condition cannot be evaluated' },
  missingUser: { 'zh-CN': '未提供假设发送者，无法判断用户条件', en: 'No hypothetical sender was provided, so the user condition cannot be evaluated' },
  missingScene: { 'zh-CN': '未提供会话目标，无法判断此条件', en: 'No conversation target was provided, so this condition cannot be evaluated' },
  combination: { 'zh-CN': '{meaning}；单项内多个值为 OR，规则之间为 AND', en: '{meaning}; values within a rule use OR, and rules use AND' },
});
