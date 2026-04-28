---
name: napcat
platforms:
  - napcat
description: >-
  NapCatQQ 适配器完整能力集。当用户在 QQ 群或私聊中请求群管理（踢人、禁言、设管理、改名片、
  设头衔）、社交互动（戳一戳、点赞、表情回应）、消息操作（合并转发、单条转发、
  消息历史回溯）、群运营（精华消息、群公告、群签到、群文件管理）、多媒体能力（AI 语音
  TTS、图片 OCR 文字识别、小程序卡片）、个人设置（修改资料/头像/签名/在线状态）、
  或任何 QQ 特有功能时，都应使用此技能。即使用户没有明确提到 NapCat 或 OneBot，
  只要上下文是 QQ 群聊/私聊场景且涉及上述能力，就应触发。覆盖 OneBot11 标准 +
  go-cqhttp 扩展 + NapCat 独有 API 共 92 个接口。
keywords:
  - napcat
  - napneko
  - onebot11
  - adapter:napcat
  - qq
  - 群管理
  - 头衔
  - 戳一戳
  - 表情回应
  - 合并转发
  - 群文件
  - 精华消息
  - 群公告
  - AI语音
  - OCR
  - 小程序
  - list_members
  - 禁言
  - 踢人
  - 点赞
  - 签到
  - 转发
  - 语音
  - 翻译
  - 头像
  - 在线状态
tags:
  - group
  - management
  - im
  - qq
  - napcat
tools:
  - napcat_kick_member
  - napcat_mute_member
  - napcat_mute_all
  - napcat_set_admin
  - napcat_set_nickname
  - napcat_set_group_name
  - napcat_list_members
  - napcat_get_group_info
  - napcat_send_poke
  - napcat_set_emoji_reaction
  - napcat_send_forward_msg
  - napcat_forward_single_msg
  - napcat_send_like
  - napcat_set_essence_msg
  - napcat_delete_essence_msg
  - napcat_get_essence_list
  - napcat_send_group_notice
  - napcat_get_group_notice
  - napcat_del_group_notice
  - napcat_upload_group_file
  - napcat_get_group_file_url
  - napcat_get_group_root_files
  - napcat_get_group_shut_list
  - napcat_set_group_portrait
  - napcat_set_title
  - napcat_group_sign
  - napcat_ai_tts
  - napcat_get_ai_characters
  - napcat_ocr_image
  - napcat_get_mini_app_ark
  - napcat_get_group_msg_history
  - napcat_get_friend_msg_history
  - napcat_get_user_status
  - napcat_get_group_info_ex
  - napcat_set_profile
  - napcat_set_avatar
  - napcat_set_online_status
  - napcat_set_signature
  - napcat_translate
  - napcat_mark_msg_as_read
  - napcat_download_file
  - napcat_delete_friend
---

# NapCat QQ 适配器技能

NapCat 是 OneBot11 协议的超集实现，提供标准群管理之外大量 QQ 特有功能。这份技能帮助你正确选择工具、组合调用、处理边界情况。

## 核心原则

### 先查后操作

用户说「把小明踢了」，但工具需要的是 QQ 号（数字），不是昵称。所有针对具体成员的操作，如果手头只有昵称/名片，第一步永远是 `napcat_list_members` 获取成员列表，从中匹配到 `user_id`，然后再执行后续操作。不要猜测 QQ 号。

**Example:**
```
用户: 把群里那个叫"小飞"的禁言10分钟
步骤1: napcat_list_members → 找到 小飞 的 user_id = 123456
步骤2: napcat_mute_member(user_id=123456, duration=600)
```

### 权限意识

工具分三个权限层级，调用前先判断 Bot 在群里的身份：

- **user** — 普通成员即可，如查询、点赞、戳一戳
- **group_admin** — 需要管理员权限，如踢人、禁言、设精华、发公告
- **group_owner** — 需要群主权限，如设管理员、设专属头衔

如果 Bot 权限不足，API 会返回错误。遇到权限不足时，向用户说明需要什么权限，而不是重试。

### 数值单位

- **禁言 duration**：单位是秒。600 = 10 分钟，3600 = 1 小时，86400 = 1 天。设为 **0** 是解除禁言，不是永久禁言。
- **message_id**：消息收到时自带的数字 ID，用于回应、精华、转发等操作。
- **group_id / user_id**：QQ 号，纯数字。

---

## 工具分类与使用指南

### 群管理（基础）

日常群管理操作。Bot 需要管理员权限（`set_admin` 需群主权限）。

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `napcat_kick_member` | 踢出成员 | `user_id` |
| `napcat_mute_member` | 禁言/解禁 | `user_id`, `duration`（秒，0=解禁） |
| `napcat_mute_all` | 全员禁言/解除 | `enable`（true/false） |
| `napcat_set_admin` | 设/取消管理员 | `user_id`, `enable` |
| `napcat_set_nickname` | 改群名片 | `user_id`, `nickname` |
| `napcat_set_group_name` | 改群名称 | `name` |
| `napcat_set_title` | 设专属头衔 | `user_id`, `title`（需群主） |
| `napcat_list_members` | 获取成员列表 | — |
| `napcat_get_group_info` | 获取群基本信息 | — |
| `napcat_get_group_info_ex` | 获取群详细信息 | — |
| `napcat_get_group_shut_list` | 获取当前禁言列表 | — |

**批量禁言场景：** 用户说「把最近刷屏的人都禁言」时，先用 `napcat_get_group_msg_history` 分析最近消息，识别刷屏用户，然后逐个 `napcat_mute_member`。

### 社交互动

不需要管理员权限的轻量交互。

| 工具 | 用途 | 说明 |
|------|------|------|
| `napcat_send_poke` | 戳一戳 | `group_id` 不传 = 私聊戳 |
| `napcat_set_emoji_reaction` | 表情回应 | 对某条消息贴表情，需 `message_id` + `emoji_id` |
| `napcat_send_like` | 给好友点赞 | 每人每天上限 10 次 |
| `napcat_group_sign` | 群签到/打卡 | 每天一次 |

**Example:**
```
用户: 戳一下群里的张三
步骤1: napcat_list_members → 找到张三 user_id = 789
步骤2: napcat_send_poke(user_id=789, group_id=当前群号)
```

### 消息操作

转发、历史查询是 NapCat 超越标准 OneBot11 的核心能力。

| 工具 | 用途 | 说明 |
|------|------|------|
| `napcat_send_forward_msg` | 合并转发 | 多条消息打包为一条转发消息 |
| `napcat_forward_single_msg` | 单条转发 | 把某条消息转到另一个群/好友 |
| `napcat_get_group_msg_history` | 群消息历史 | 支持指定起始序号和条数 |
| `napcat_get_friend_msg_history` | 私聊历史 | 同上 |
| `napcat_mark_msg_as_read` | 标记已读 | — |

**合并转发的 messages 格式：**

`messages` 参数是 JSON 字符串，每个元素是一个 node 节点：

```json
[
  {
    "type": "node",
    "data": {
      "name": "发送者昵称",
      "uin": "10001",
      "content": [{"type": "text", "data": {"text": "消息内容"}}]
    }
  }
]
```

也可以用 `id` 引用已有消息：`{"type": "node", "data": {"id": "消息ID"}}`

### 群运营

精华消息、群公告、群文件、群头像 — 让群看起来正规且有序。

| 工具 | 用途 | 权限 |
|------|------|------|
| `napcat_set_essence_msg` | 设为精华消息 | admin |
| `napcat_delete_essence_msg` | 取消精华 | admin |
| `napcat_get_essence_list` | 精华消息列表 | user |
| `napcat_send_group_notice` | 发群公告 | admin |
| `napcat_get_group_notice` | 查看公告 | user |
| `napcat_del_group_notice` | 删除公告 | admin |
| `napcat_upload_group_file` | 上传群文件 | user |
| `napcat_get_group_file_url` | 获取文件下载链接 | user |
| `napcat_get_group_root_files` | 群文件列表 | user |
| `napcat_set_group_portrait` | 修改群头像 | admin |

**群公告带图：** `napcat_send_group_notice` 的 `image` 参数支持 URL 或 base64，方便把生成的图片直接发到公告里。

**群文件工作流：** 用户说「帮我把这个文件发到群里」→ 用 `napcat_upload_group_file`，`file` 可以是本地路径或 URL。如果用户问「群里那个文件在哪下载」→ 先 `napcat_get_group_root_files` 列出文件，找到 `file_id` 和 `busid`，再 `napcat_get_group_file_url` 获取下载链接。

### AI 与多媒体

NapCat 独有的多媒体处理能力，标准 OneBot11 不支持这些。

| 工具 | 用途 | 说明 |
|------|------|------|
| `napcat_ai_tts` | AI 文字转语音 | 在群里发语音，需指定角色 |
| `napcat_get_ai_characters` | 语音角色列表 | 配合 ai_tts 使用 |
| `napcat_ocr_image` | 图片文字识别 | 传入图片的 file 字段 |
| `napcat_get_mini_app_ark` | 小程序卡片签名 | 生成可分享的小程序卡片 |
| `napcat_translate` | 英译中翻译 | NapCat 内置翻译 |
| `napcat_download_file` | 下载文件到缓存 | 返回本地路径 |

**AI 语音工作流：** 用户说「用甜美女声读一段话」→ 先 `napcat_get_ai_characters` 列出可用角色，从中选择匹配的 `character_id`，然后 `napcat_ai_tts(character=所选ID, text=要读的内容)`。角色列表因群不同可能不一样，所以每次都应重新查询。

**OCR 使用：** 当用户发了一张带文字的图片并问「这上面写了什么」，从消息中提取图片的 `file` 字段（通常是 `file://...` 或一个 hash），传给 `napcat_ocr_image`。

### 个人设置

修改 Bot 自身的 QQ 资料，通常是用户明确要求时才使用。

| 工具 | 用途 |
|------|------|
| `napcat_set_profile` | 修改昵称、公司、邮箱等 |
| `napcat_set_avatar` | 换头像（URL 或 base64） |
| `napcat_set_online_status` | 设在线状态 |
| `napcat_set_signature` | 设个性签名 |
| `napcat_delete_friend` | 删除好友 |
| `napcat_get_user_status` | 查看某人在线状态 |

**在线状态码：** 11=在线, 21=离开, 31=隐身, 41=忙碌, 50=请勿打扰, 60=Q我吧。

---

## 常见场景决策树

### 用户想管理群成员

```
用户提供了 QQ 号？
  ├─ 是 → 直接操作
  └─ 否（只有昵称/名片）
      └─ napcat_list_members → 匹配 → 操作
```

### 用户想查看/操作消息历史

```
群聊还是私聊？
  ├─ 群聊 → napcat_get_group_msg_history(group_id)
  └─ 私聊 → napcat_get_friend_msg_history(user_id)

想转发其中某条？
  ├─ 转单条 → napcat_forward_single_msg(message_id)
  └─ 打包多条 → napcat_send_forward_msg(messages=[node...])
```

### 用户想发语音

```
napcat_get_ai_characters(group_id) → 列出角色
选择最匹配的 character_id
napcat_ai_tts(group_id, character, text)
```

### 用户想发公告/管理精华

```
发新公告 → napcat_send_group_notice(content, image?)
查看公告 → napcat_get_group_notice
删除公告 → 先 get 拿到 notice_id → napcat_del_group_notice

设精华 → napcat_set_essence_msg(message_id)
取消精华 → napcat_delete_essence_msg(message_id)
看精华列表 → napcat_get_essence_list
```

---

## 易错点

1. **禁言 duration=0 是解禁**，不是永久禁言。没有「永久禁言」的概念，最长可以设很大的数（如 2592000 = 30 天）。

2. **合并转发的 messages 必须是 JSON 字符串**，不是对象。工具内部会解析，但传参时要传字符串化的 JSON。

3. **头衔（set_title）只有群主能设**，管理员不行。用户说「给他加个头衔」但 Bot 不是群主时，需告知无法操作。

4. **点赞有每日上限**（每人 10 次），用户说「给他点 100 个赞」时要说明限制。

5. **AI 语音只能在群聊用**，私聊不支持。如果用户在私聊请求 AI 语音，建议改用群聊。

6. **群文件操作需要 file_id 和 busid 两个参数**，它们来自 `get_group_root_files` 的返回，不要编造。

7. **OCR 的 image 参数**不是图片 URL，而是消息中图片的 `file` 字段值（形如 `xxxxx.image` 或本地路径）。
