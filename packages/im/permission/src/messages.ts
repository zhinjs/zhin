import { createMessages } from '@zhin.js/plugin-runtime';

export const permissionMessages = createMessages({
  unknownRule: { 'zh-CN': '未知或自定义规则未执行；命令声明仅支持内置 DSL', en: 'Unknown or custom rules were not executed; command declarations support only the built-in DSL' },
  adapter: { 'zh-CN': '按完整 adapter、路径末段或末段以“值-”开头匹配；星号不表示任意适配器', en: 'Matches the complete adapter, its final path segment, or a final segment starting with value-; an asterisk does not mean any adapter' },
  group: { 'zh-CN': '要求群聊，按群 ID 匹配；空值或星号不限群 ID', en: 'Requires a group conversation and matches the group ID; an empty value or asterisk allows any group ID' },
  private: { 'zh-CN': '要求私聊，按会话 ID 匹配；空值或星号不限会话 ID', en: 'Requires a private conversation and matches its ID; an empty value or asterisk allows any conversation ID' },
  channel: { 'zh-CN': '要求频道，按频道 ID 匹配；空值或星号不限频道 ID', en: 'Requires a channel conversation and matches the channel ID; an empty value or asterisk allows any channel ID' },
  user: { 'zh-CN': '按发送者 ID 精确匹配', en: 'Matches the sender ID exactly' },
  role: { 'zh-CN': '按发送者在本会话层级链上的聊天角色匹配；owner 包含 admin，admin 包含 trusted', en: 'Matches the sender\'s chat role along this conversation\'s scope chain; owner includes admin, admin includes trusted' },
  platform: { 'zh-CN': '按平台归一地位匹配；platform:admin 也接受群主', en: 'Matches the normalized platform standing; platform:admin also accepts the owner' },
  'platform-role': { 'zh-CN': '要求发送者拥有该平台角色 id', en: 'Requires the sender to hold this platform role id' },
  'platform-permission': { 'zh-CN': '要求发送者拥有该平台权限', en: 'Requires the sender to hold this platform permission' },
  bot: { 'zh-CN': '按机器人账号自身在本会话的归一平台地位匹配；bot:admin 也接受群主；机器人身份未知时不满足', en: 'Matches the Bot account\'s own normalized standing in this conversation; bot:admin also accepts owner; unknown standing does not match' },
  'bot-role': { 'zh-CN': '要求机器人账号自身拥有该平台角色 id', en: 'Requires the Bot account itself to hold this platform role id' },
  'bot-permission': { 'zh-CN': '要求机器人账号自身拥有该平台权限', en: 'Requires the Bot account itself to hold this platform permission' },
  missingBot: { 'zh-CN': '未提供假设的机器人平台身份，无法判断机器人条件', en: 'No hypothetical Bot standing was provided, so the Bot condition cannot be evaluated' },
  deniedGeneric: { 'zh-CN': '不满足使用条件。', en: 'The conditions for this are not met.' },
  // ADR 0060 §5.3 / zhinjs/zhin#1250 第 78 批: the one source of role refusals (commands, buttons,
  // management commands). They say where roles come from, never which role or who holds it.
  deniedRole: {
    'zh-CN': '此功能需要 zhin 角色。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。',
    en: 'This needs a zhin role. Ask the owner of this bot to grant one, in chat or on the Console "Chat roles" page.',
  },
  deniedRoleStanding: {
    'zh-CN': '此功能需要 zhin 角色，群主 / 群管理员的平台身份不等于 zhin 角色。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。',
    en: 'This needs a zhin role, and being a group owner / admin on the platform is not one. Ask the owner of this bot to grant one, in chat or on the Console "Chat roles" page.',
  },
  // Host-wide abilities (restart, configuration, owner approvals, `owner@global` permits): ADR 0056 §2.
  globalOwnerOnly: { 'zh-CN': '仅全局聊天主人（global owner）可使用此指令。', en: 'Only a global chat owner can use this command.' },
  globalOwnerPrivateOnly: { 'zh-CN': '仅全局聊天主人（global owner）可在私聊中使用此指令。', en: 'Only a global chat owner can use this command, in a private chat.' },
  deniedGlobalOwner: { 'zh-CN': '此功能需要全局聊天主人（global owner）。', en: 'This needs a global chat owner.' },
  // `{bind}`: the chat invocation of the `bind` command (with the endpoint's command prefix) when the
  // caller knows it, else `绑定` / `bind` and `{prefixHint}` says to add a configured prefix.
  globalOwnerGrant: {
    'zh-CN': '全局 owner 在 Console「聊天角色」页授予，授予前先私聊机器人发送「{bind} <码>」{prefixHint}把聊天身份绑定到 Console 账号；还没有全局 owner 时，部署者也可私聊机器人发送「认领 <码>」（不需要命令前缀，码见 zhin status）。',
    en: 'Global owners are granted on the Console "Chat roles" page; first bind your chat identity to a Console account: send 「{bind} <code>」{prefixHint} to the bot in a private chat. While there is no global owner, the deployer can also send 「claim <code>」 to the bot in a private chat (no command prefix needed; zhin status shows the code).',
  },
  bindWord: { 'zh-CN': '绑定', en: 'bind' },
  bindPrefixHint: { 'zh-CN': '（配置了命令前缀时带上前缀）', en: ' (with the command prefix, if one is configured)' },
  deniedConversationManager: {
    'zh-CN': '群聊和频道里需要本会话的 zhin 聊天角色 admin（或 owner）；私聊中可以直接管理本会话。请联系本机器人的主人授予，或由主人在 Console「聊天角色」页授予。',
    en: 'In a group or channel this needs the zhin chat role admin (or owner) of this conversation; in a private chat you manage your own conversation. Ask the owner of this bot to grant one, in chat or on the Console "Chat roles" page.',
  },
  deniedCommand: { 'zh-CN': '没有权限执行此指令。', en: 'You do not have permission to run this command.' },
  deniedCommandHere: { 'zh-CN': '无法执行此指令。', en: 'This command cannot run here.' },
  deniedPrivate: { 'zh-CN': '此指令只能在私聊中使用，请私聊机器人发送。', en: 'This command works in a private chat only; send it to the bot privately.' },
  deniedPlatformOwner: { 'zh-CN': '需要你是本群群主。', en: 'You need to be the owner of this group.' },
  deniedPlatformAdmin: { 'zh-CN': '需要你是本群群主或管理员。', en: 'You need to be an owner or admin of this group.' },
  deniedPlatformRole: { 'zh-CN': '需要你拥有平台角色 {value}。', en: 'You need the platform role {value}.' },
  deniedPlatformPermission: { 'zh-CN': '需要你拥有平台权限 {value}。', en: 'You need the platform permission {value}.' },
  deniedBotOwner: { 'zh-CN': '机器人不是本群群主（或无法确认其身份）。', en: 'The bot is not the owner of this group (or its standing is unknown).' },
  deniedBotAdmin: { 'zh-CN': '机器人不是本群管理员（或无法确认其身份）。', en: 'The bot is not an admin of this group (or its standing is unknown).' },
  deniedBotRole: { 'zh-CN': '机器人没有平台角色 {value}（或无法确认其身份）。', en: 'The bot does not hold the platform role {value} (or its standing is unknown).' },
  deniedBotPermission: { 'zh-CN': '机器人没有平台权限 {value}（或无法确认其身份）。', en: 'The bot does not have the platform permission {value} (or its standing is unknown).' },
  deniedUser: { 'zh-CN': '此功能只对指定用户开放。', en: 'This is limited to specific users.' },
  deniedScene: { 'zh-CN': '此功能在当前会话不可用。', en: 'This is not available in this conversation.' },
  missingRole: { 'zh-CN': '未提供假设角色，无法判断角色条件', en: 'No hypothetical roles were provided, so the role condition cannot be evaluated' },
  missingPlatform: { 'zh-CN': '未提供假设平台身份，无法判断平台条件', en: 'No hypothetical platform standing was provided, so the platform condition cannot be evaluated' },
  missingUser: { 'zh-CN': '未提供假设发送者，无法判断用户条件', en: 'No hypothetical sender was provided, so the user condition cannot be evaluated' },
  missingScene: { 'zh-CN': '未提供会话目标，无法判断此条件', en: 'No conversation target was provided, so this condition cannot be evaluated' },
  combination: { 'zh-CN': '{meaning}；单项内多个值为 OR，规则之间为 AND', en: '{meaning}; values within a rule use OR, and rules use AND' },
});
