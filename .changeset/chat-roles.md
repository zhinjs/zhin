---
"@zhin.js/adapter": patch
"@zhin.js/adapter-bilibili": patch
"@zhin.js/adapter-bilibili-live": patch
"@zhin.js/adapter-dingtalk": patch
"@zhin.js/adapter-discord": patch
"@zhin.js/adapter-douyin-live": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-github": patch
"@zhin.js/adapter-icqq": patch
"@zhin.js/adapter-juejin": patch
"@zhin.js/adapter-kook": patch
"@zhin.js/adapter-lark": patch
"@zhin.js/adapter-line": patch
"@zhin.js/adapter-milky": patch
"@zhin.js/adapter-napcat": patch
"@zhin.js/adapter-onebot11": patch
"@zhin.js/adapter-onebot12": patch
"@zhin.js/adapter-qq": patch
"@zhin.js/adapter-sandbox": patch
"@zhin.js/adapter-satori": patch
"@zhin.js/adapter-slack": patch
"@zhin.js/adapter-telegram": patch
"@zhin.js/adapter-wechat-mp": patch
"@zhin.js/adapter-wecom": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/command": patch
"@zhin.js/console-protocol": minor
"@zhin.js/core": patch
"@zhin.js/feature-kit": patch
"@zhin.js/im-contract": patch
"@zhin.js/permission": patch
"@zhin.js/plugin-bilibili": patch
"@zhin.js/plugin-calendar": patch
"@zhin.js/plugin-content-moderation": patch
"@zhin.js/plugin-earthquake": patch
"@zhin.js/plugin-group-suite": patch
"@zhin.js/plugin-music": patch
"@zhin.js/plugin-roulette": patch
"@zhin.js/runtime": minor
"@zhin.js/testing": patch
"zhin.js": patch
---

聊天角色（ADR 0056）：平台身份归一、owner / admin / trusted 三个角色分四级、映射规则可分层配置。升级说明见 docs/migrations/chat-roles.md。

- zhin.js：实例首次启动把适配器 `master` / `trusted`、`endpoints[i].master|trusted` 与 `ai.trigger.masters|trusted` 迁入项目数据库 `chat_roles`（先记入 `.zhin/chat-roles-migration.json`，再从配置移除并记日志）；之后配置再出现这些字段时启动报错并指向升级指南。新增会话层映射规则表 `chat_role_mappings`；`features.selfService.platformAdmins|roles|allowUsers` 删除（改用 `roles.mappings`）；聊天改配置、聊天重启、Agent 主人审批按聊天角色 `owner` 判断。
- @zhin.js/core：角色模型与解析移入 core（`ChatRoleService`、映射规则、`createChatRoleSenderEnricher`），入站消息带 `sender.chatRole` 与归一的 `sender.platform`；删除 `SenderRole`、`senderRolesFromMessage`、`roleSatisfies` 等，`master` 改名 `owner`；`createSenderEnricher` / `createConfigurationChatAuthorizer` 改为基于聊天角色，删除 `createEndpointRoleResolver` / `createEndpointRoleConfigurationSelection`；`ai.trigger.masters|trusted` 删除。
- @zhin.js/permission：permit 新语法 `owner` / `admin` / `trusted` / `role(...)`（聊天角色）与 `platform:owner|admin`、`platform-role:<id>`、`platform-permission:<name>`；删除 `role(master)`、`scene_admin`、`scene_owner`、`platform(adapter,perm)` 及 `registerPlatform`、`createSceneRolePlatformChecker`、`platformPermission`、`definePlatformPermission`，定义时报错并给出替代写法。
- @zhin.js/command：命令会话的发送者改为 `chatRole` / `platform`，不再从 metadata 读角色；`CONVERSATION_MANAGER_PERMIT` 改为 `admin`。
- @zhin.js/feature-kit：`OperationSession.sender` 改为 `chatRole` / `platform`。
- @zhin.js/im-contract：新增 `PlatformStanding`。
- @zhin.js/adapter：入站 sender 可带 `platform`；账号管理命令需要聊天角色 `owner`。
- @zhin.js/agent：危险工具、文件策略、主人审批、群规豁免与审批、Agent 回合主体改读聊天角色（`principal.roles` 只含展开的聊天角色，平台地位在 `principal.platform`）；`SenderRole` → `PrincipalRole`，`SELF_CHANGE_MASTER_ROLE` → `SELF_CHANGE_OWNER_ROLE`。
- @zhin.js/ai：注释更新。
- @zhin.js/console-protocol：新增 `chat-roles.mappings` / `chat-roles.set-mappings`（`iam.manage`）及映射规则类型；`ConsoleChatRoleSource` 去掉 `config`。
- @zhin.js/runtime：Host 配置 Schema 删除 `features.selfService.platformAdmins|roles|allowUsers`。
- @zhin.js/testing：伪造消息与 `PluginTestKit` 用 `sender.chatRole` 声明测试身份。
- 适配器：配置 Schema 删除 `master` / `trusted`，新增 `roles`（映射规则）；工具 permit 改为 `platform-permission:<name>`，不再注册平台 checker。
- 插件：内容审核以 `inbound.bypassRole` 取代 `masters` / `inbound.bypassMasters`；群管、音乐、日历、地震、B 站、轮盘赌的权限改用聊天角色。
