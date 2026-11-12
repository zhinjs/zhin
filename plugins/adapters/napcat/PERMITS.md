# NapCat Platform Permits（QQ 群）

## 入站字段

OneBot `sender.role` 透传：`owner` · `admin` · `member`。

| 字段 | 写入 |
|------|------|
| `$sender.role` | `owner` / `admin` |
| `$sender.permissions` | 同 `role` |

## Permit 词汇表

| `platform-permission:…` | 含义 |
|----------------------|------|
| `platform:owner` | 群主 |
| `platform:admin` | 群管理员（含群主） |

使用 core 默认 `createSceneRolePlatformChecker`。

## 目标来源

群工具只作用于当前群（不接受 `group_id`）：精华列表、群公告列表、群文件（根目录、下载链接、上传）、群消息历史、AI 语音与角色列表、群详情、禁言列表、群签到；`napcat_get_friend_msg_history` 只读当前私聊；`napcat_send_poke` 在当前群戳指定成员、私聊中戳对方；`napcat_send_forward_msg` 发往当前会话，引用已有消息的节点只能引用当前会话的消息。

| 工具 | Permit | 原因 |
|------|--------|------|
| `napcat_forward_single_msg` | `owner@global` | 把账号的任意消息转发到任意好友 / 群（跨会话） |
| `napcat_upload_group_file` | `owner@global` | `file` 可为宿主机本地路径（宿主文件读取） |
| `napcat_set_group_portrait` | `owner@global` + `bot:admin` | `file` 可为宿主机本地路径（OneBot 读取 `file://`） |
| `napcat_set_avatar` | `owner@global` | 同上，且改的是机器人账号身份 |
| `napcat_download_file` | `owner@global` | 由宿主网络拉取任意 URL 并写入宿主文件系统 |

`napcat_ocr_image`、`napcat_send_group_notice` 的图片与 `napcat_send_forward_msg` 节点内的媒体只接受 http(s) 链接、`base64://` 或平台文件标识，拒绝 `file://` 与本机路径。
