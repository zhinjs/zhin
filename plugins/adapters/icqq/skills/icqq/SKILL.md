---
name: icqq
platforms:
  - icqq
description: '通过 icqq 命令行操作 QQ 账号。适用于：发私聊或群消息、撤回、查聊天记录；好友（列表、资料、备注、戳一戳、点赞、删好友、分组）；群（禁言、踢人、公告、签到、精华、成员、邀请、全体禁言）；好友/群验证与入群请求；群文件；昵称头像签名、在线状态；黑名单、OCR、Webhook、通知；登录与守护进程。用户提到 QQ、企鹅、好友、群聊、@、撤回、禁言、踢人、加群、好友请求、群文件、签到等时使用本技能。'
argument-hint: '用一句话说明要对 QQ 执行的操作，例如「给好友 12345 发一条你好」或「把群 11111 里的用户 67890 禁言 10 分钟」'
disable-model-invocation: true
---

# icqq — 用命令行操作 QQ

通过 **`icqq`** 命令行工具操作 QQ。需先 **`icqq login`** 启动守护进程后再执行其它命令。

## 使用流程

1. **判断模块** — 对照下方「模块表」，匹配用户意图属于哪一类
2. **只读对应参考** — 仅打开与意图相关的 `references/*.md`，不要凭记忆猜命令
3. **执行命令** — 在终端运行 `icqq …`，把结果回报给用户；未登录或守护未起时命令失败即如实说明

## 模块表

按用户想做的事，打开对应参考文件：

| 用户意图 | 模块 | 参考文档 |
|----------|------|----------|
| 发消息、撤回、聊天记录、消息详情、合并转发 | 消息 | [messaging.md](./references/messaging.md) |
| 好友列表、查看、发消息、戳一戳、点赞、删除、备注、文件、好友分组 | 好友 | [friends.md](./references/friends.md) |
| 群：发消息、禁言、踢人、公告、邀请、签到、精华、成员、表态 | 群管理 | [groups.md](./references/groups.md) |
| 昵称、头像、签名、群名片、群头衔、加群方式、匿名等设置 | 设置 | [settings.md](./references/settings.md) |
| 好友请求、群请求、入群验证 | 请求 | [requests.md](./references/requests.md) |
| 群文件：目录、上传下载、转发 | 群文件 | [gfs.md](./references/gfs.md) |
| 登录、服务/守护、配置、OCR、黑名单、Webhook、通知、UID 转换、陌生人、漫游表情、缓存、重载、频道、RPC、补全 | 通用 | [general.md](./references/general.md) |

## 全局约定

- `<uid>` = QQ 号（数字），`<gid>` = 群号（数字）
- 多账号：全局参数 `-u <uin>` 或环境变量 `ICQQ_CURRENT_UIN`；默认用配置里的 `currentUin`
- **自动执行发消息** 优先用 **`icqq friend send` / `icqq group send`**（非交互）；`icqq friend chat` / `icqq group chat` 为交互式，不适合代理串行跑
- CQ 码片段：`[face:id]` `[image:路径或URL]` `[at:uid]` `[at:all]` `[dice]` `[rps]`
- 含空格的内容用英文双引号包起来：`icqq friend send 12345 "你好 世界"`
- 批量操作用 `&&` 串联多条命令
