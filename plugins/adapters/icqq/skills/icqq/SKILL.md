---
name: icqq
description: 'Operate QQ account via icqq CLI. Use when asked to: send QQ message, manage QQ groups, check QQ friends, poke friend, like friend, mute member, kick member, set nickname, view QQ profile, handle friend/group requests, manage group files, set group announcement, QQ签到, 发消息, 管群, 好友操作, 群文件.'
argument-hint: 'Describe what QQ operation to perform, e.g. "send hello to friend 12345" or "mute user 67890 in group 11111"'
disable-model-invocation: true
---

# icqq — QQ Account Operations via CLI

Operate a QQ account through the `icqq` command-line tool. The daemon must be running first (`icqq login`).

## Procedure

1. **Identify the module** — Match the user's intent to one of the modules below
2. **Load the reference** — Read ONLY the relevant module reference file(s)
3. **Check daemon** — Run `icqq status` if unsure whether the account is online
4. **Execute** — Run the command in terminal and report results

## Modules

Load the corresponding reference file based on what the user wants:

| Intent | Module | Reference |
|--------|--------|-----------|
| 发消息、撤回、聊天记录、消息详情、合并转发 | Messaging | [messaging.md](./references/messaging.md) |
| 好友列表、查看、发消息、戳一戳、点赞、删除、备注、文件、好友分组 | Friends | [friends.md](./references/friends.md) |
| 群管理：发消息、禁言、踢人、公告、邀请、签到、精华、成员、表态 | Groups | [groups.md](./references/groups.md) |
| 设置：昵称、头像、签名、群名片、群头衔、加群方式、匿名 | Settings | [settings.md](./references/settings.md) |
| 好友/群请求处理 | Requests | [requests.md](./references/requests.md) |
| 群文件：目录管理、上传下载、转发 | Group Files | [gfs.md](./references/gfs.md) |
| 登录、状态、配置、OCR、黑名单、Webhook、通知、UID转换、陌生人、漫游表情、缓存、重载、频道与子频道（Guild & Channel）、补全 | General | [general.md](./references/general.md) |

## Global Notes

- All `<uid>` = QQ number (integer), `<gid>` = group number (integer)
- Daemon must run first: `icqq login`
- Multi-instance: use `-u <uin>` or `ICQQ_CURRENT_UIN` env to specify account; defaults to `config.currentUin`
- **Use `icqq friend send` / `icqq group send` for non-interactive messaging** (agent-friendly); `icqq friend chat` / `icqq group chat` are interactive
- CQ code syntax in messages: `[face:id]` `[image:path]` `[at:uid]` `[at:all]` `[dice]` `[rps]`
- Quote strings with spaces: `icqq friend send 12345 "hello world"`
- Chain batch ops with `&&`
