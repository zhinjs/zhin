# tencent-channel-community

<p align="center">
  <img src="https://grouppro.gtimg.cn/wupload/xy/qq_channel/common_pic/kRjatyOL.png" alt="tencent-channel-community" width="120">
</p>

<p align="center">
  <strong>🏠 一站式腾讯频道社区管理技能</strong>
</p>

<p align="center">
  简体中文 | <a href="./README_EN.md">English</a>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.4-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License">
</p>


---

## 📖 简介

**tencent-channel-community** 是一款全功能的腾讯频道社区管理技能，涵盖频道创建与管理、成员管理、帖子发布、内容审核等完整能力，让 AI 助手能够高效地帮助你管理腾讯频道社区。

所有操作通过 `tencent-channel-cli <domain> <action>` 调用，支持两种传参模式：

- **stdin JSON**：`echo '{"guild_id":"123"}' | tencent-channel-cli manage get-guild-info`
- **CLI flag**：`tencent-channel-cli manage get-guild-info --guild-id 123`

🔗 **官方网站**: [https://connect.qq.com/ai](https://connect.qq.com/ai)

---

## ✨ 功能特性

### 📌 频道管理

- **创建频道** - 创建公开或私密主题频道，支持预览创建效果
- **频道设置** - 查看/修改频道资料、头像、名称、简介
- **版块管理** - 创建、修改、删除子版块
- **成员管理** - 查看已加入的频道、频道成员、子频道列表，支持按昵称搜索成员
- **搜索功能** - 搜索频道、帖子、作者，支持跨频道全局搜索和频道内搜索
- **分享功能** - 获取频道和帖子分享链接，解析分享链接
- **频道号管理** - 修改频道号（10~14 位英文/数字，需频道主权限）
- **管理操作** - 加入频道（支持多种验证方式）、退出频道、频道私信、加入设置管理、禁言/踢人、设置/移除管理员（需管理员权限）

### 📰 内容管理（帖子）

- **浏览帖子** - 浏览频道主页或指定板块的帖子列表，支持翻页
- **帖子详情** - 查看帖子详情、评论与回复，支持单独获取帖子分享短链
- **发布编辑** - 发帖、改帖、删帖、移帖（支持图片/视频帖子）
- **内联语法** - 正文内嵌可点击链接 `[文本](url)` 与 @用户 `@[昵称](tinyid)`，评论/回复同样支持
- **话题标签** - 短贴支持 `#话题`，长贴不支持
- **互动功能** - 评论、回复、点赞、精华、置顶
- **运营工具** - 内容巡检、问答类自动回复

### 🔔 消息通知

- **两步开启** - 先测试推送验证通道，用户确认收到后正式开启；**仅支持 OpenClaw 平台**
- **多通道订阅** - 可从不同通道（如 QQBot、飞书）分别开启，各通道独立路由并行推送
- **三类通知** - 互动消息（顶帖/点赞/评论/回复/@）、系统消息（加入申请等）、私信消息
- **快捷处理** - 上下文出现通知后，直接说「回复他」「评论他」「同意」「拒绝」「回复私信」即可一步完成
- **Token 安全** - 更换 Token 时自动停止通知服务并清理本地状态

---

## 🚀 快速开始

### 环境要求

- **Node.js**（tencent-channel-cli 需要）
- **Token**：从 [https://connect.qq.com/ai](https://connect.qq.com/ai) 获取

### 安装方式

从 [https://connect.qq.com/ai](https://connect.qq.com/ai) 获取一键安装命令

### 环境验证

```bash
tencent-channel-cli version            # 检查是否安装
tencent-channel-cli token verify       # 验证登录状态
tencent-channel-cli doctor             # 自检连通性
```

### Windows / PowerShell

- 优先使用 CLI flag 传参；复杂对象、数组等场景建议使用 `ConvertTo-Json`
- 若 `.ps1` 执行策略受限，优先改用 `tencent-channel-cli.cmd`
- 不建议直接照抄 bash 风格的 `echo '{...}' | ...` 用法

---

## 📚 使用示例

### 创建频道
![创建频道](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E5%88%9B%E5%BB%BA%E9%A2%91%E9%81%93.png)

### 获取我加入的频道
![获取我加入的频道](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E8%8E%B7%E5%8F%96%E6%88%91%E5%8A%A0%E5%85%A5%E7%9A%84%E9%A2%91%E9%81%93.png)

### 查询频道资料
![查询频道资料](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E6%9F%A5%E8%AF%A2%E9%A2%91%E9%81%93%E8%B5%84%E6%96%99.png)

### 成员管理
![成员管理](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E6%88%90%E5%91%98%E7%AE%A1%E7%90%86.png)

### 获取最新的5条帖子
![获取最新的5条帖子](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E8%8E%B7%E5%8F%96%E6%9C%80%E6%96%B0%E7%9A%845%E6%9D%A1%E5%B8%96%E5%AD%90.png)

### 查询帖子并总结
![查询帖子并总结](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E6%9F%A5%E8%AF%A2%E5%B8%96%E5%AD%90%E5%B9%B6%E6%80%BB%E7%BB%93.png)

### 发表带图帖子
![发表带图帖子](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E5%8F%91%E8%A1%A8%E5%B8%A6%E5%9B%BE%E5%B8%96%E5%AD%90.png)

### 点赞并评论
![点赞并评论](https://qqchannel-profile-1251316161.file.myqcloud.com/qq-ai-connect/example/%E7%82%B9%E8%B5%9E%E5%B9%B6%E8%AF%84%E8%AE%BA.png)

---

## 🔧 可用工具

### 频道管理工具

| 工具名 | 说明 |
|--------|------|
| `verify` | 校验 Token 和 CLI 连通性 |
| `get-my-join-guild-info` | 获取当前账号已加入的频道列表 |
| `get-guild-info` | 获取频道资料 |
| `get-guild-member-list` | 获取频道成员列表（支持分页） |
| `guild-member-search` | 按昵称搜索频道成员 |
| `get-guild-channel-list` | 获取子频道（版块）列表 |
| `get-user-info` | 获取成员资料 |
| `search-guild-content` | 搜索频道、帖子、作者或全部（跨频道全局搜索） |
| `get-guild-share-url` | 获取频道分享链接 |
| `get-share-info` | 解析分享链接（pd.qq.com 域名） |
| `get-join-guild-setting` | 查看频道加入设置与验证方式 |
| `update-join-guild-setting` | 修改频道加入设置 |
| `preview-theme-private-guild` | 预览创建频道（不实际创建） |
| `create-theme-private-guild` | 创建公开/私密主题频道 |
| `join-guild` | 加入频道（自动预检验证方式） |
| `leave-guild` | 退出频道 |
| `modify-member-shut-up` | 禁言/解禁成员 |
| `kick-guild-member` | 踢出频道成员 |
| `upload-guild-avatar` | 修改频道头像 |
| `update-guild-info` | 修改频道名称和简介 |
| `modify-guild-number` | 修改频道号（10~14 位英文/数字，需频道主权限） |
| `create-channel` | 创建子版块 |
| `modify-channel` | 修改子版块 |
| `delete-channel` | 删除子版块（不可逆） |
| `add-admin` | 设置管理员（支持批量） |
| `remove-admin` | 移除管理员（支持批量） |
| `push-group-dm-msg` | 向指定用户发送频道私信（支持 `--ref` 回复私信通知） |

### 内容管理工具

| 工具名 | 说明 |
|--------|------|
| `get-guild-feeds` | 获取频道主页帖子（热门/最新） |
| `get-channel-timeline-feeds` | 获取指定板块帖子 |
| `get-feed-detail` | 获取帖子详情 |
| `get-feed-comments` | 获取帖子评论 |
| `get-next-page-replies` | 获取下一页回复 |
| `get-feed-share-url` | 获取指定帖子的分享短链 |
| `search-guild-feeds` | 频道内按关键词搜索帖子 |
| `get-notices` | 获取互动消息（顶帖/点赞/评论/回复/@） |
| `publish-feed` | 发布新帖子（文字/图片/视频，支持内联链接与 @） |
| `alter-feed` | 修改帖子 |
| `del-feed` | 删除帖子 |
| `move-feed` | 将帖子移动到其他版块 |
| `do-comment` | 发表/删除评论（支持 `--ref` 从通知自动填充） |
| `do-reply` | 发表/删除回复（支持 `--ref` 从通知自动填充） |
| `do-like` | 评论或回复点赞/取消点赞 |
| `do-feed-prefer` | 帖子点赞/取消点赞 |
| `set-feed-essence` | 设置/取消精华帖 |
| `top-feed` | 置顶/取消置顶帖子 |
| `push-essence-feed` | 推送精华帖通知 |
| `upload-image` | 上传媒体文件（publish-feed 自动调用） |

### 消息通知工具

| 工具名 | 说明 |
|--------|------|
| `notices-on` | 开启频道消息通知（两步流程：先测试推送，用户确认后加 `--confirm` 正式开启；仅支持 OpenClaw） |
| `notices-off` | 关闭通知（带 `--session-key` 时仅移除该通道，不带时全量关闭） |
| `notices-status` | 查看订阅状态、推送模式与服务运行情况 |
| `check-notices` | 手动增量拉取新通知（与本地水位线对比） |
| `get-recent-notices` | 纯本地读取最近通知，用于匹配引用回复 |
| `deal-notice` | 处理系统通知（如加入申请的 `agree` / `refuse`） |

---

## ⚡ 快捷命令

快捷命令将多步操作合并为一次调用，提高处理效率。

| 意图 | 命令 |
|------|------|
| 搜索频道并加入 | `tencent-channel-cli manage search-and-join --keyword "<关键词>" --json` |
| 在频道内发帖 | `tencent-channel-cli feed quick-publish --content "<内容>" --json` |
| 搜索帖子并评论 | `tencent-channel-cli feed search-and-comment --guild-id <ID> --query "<关键词>" --content "<评论>" --json` |
| 删帖并禁言 | `tencent-channel-cli feed delete-and-mute --guild-id <ID> --query "<关键词>" --json` |
| 获取最新帖子详情并总结 | `tencent-channel-cli feed latest-feeds-detail --json` |
| 获取热门帖子详情并总结 | `tencent-channel-cli feed hot-feeds-detail --json` |

快捷命令为多轮交互模式：返回 `status: "waiting"` 时必须继续执行返回的 `resume_command`，按模板填写 `--pick <INDEX>` 或 `--set key=value` 完成交互，不要误判为卡住。所有快捷命令调用必须加 `--json` flag。

---

## ⚠️ 注意事项

### 权限说明
所有操作使用当前 Token 对应用户的权限。

### 高风险操作
`del-feed`、`kick-guild-member`、`modify-member-shut-up`、`delete-channel`、`remove-admin` 等为不可逆或高风险操作，执行时需加 `--yes` 确认。

---

## 📁 项目结构

```
tencent-channel-community/
├── SKILL.md                    # AI 技能说明文件（CLI 调用规则与场景路由）
├── _meta.json                  # 技能元数据
├── references/
│   ├── manage-guild.md         # 频道管理参考文档
│   ├── manage-member.md        # 成员管理参考文档
│   ├── feed-reference.md       # 内容管理参考文档
│   └── notification-reference.md # 消息通知参考文档
├── README.md                   # 中文说明
└── README_EN.md                # English README
```

---

## 🤝 反馈与社区

加入我们的腾讯频道社区，获取支持和参与讨论：

🔗 **[腾讯AI互联开发社区](https://pd.qq.com/s/1sly18j1i?b=9)**

---

## 📄 许可证

许可证：MIT

---

## 👥 作者

**Tencent**

---

<p align="center">
  Made with ❤️ for 腾讯频道社区
</p>
