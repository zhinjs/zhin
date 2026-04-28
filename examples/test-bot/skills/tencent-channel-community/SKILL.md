---
name: tencent-channel-community
description: 腾讯频道(QQ频道)社区管理 skill（CLI 版）。频道创建/设置/搜索/加入/退出，成员管理/禁言/踢人，帖子发布/编辑/删除/移动/搜索，评论/回复/点赞，版块管理，分享链接解析，频道私信，加入设置管理，内容巡检，问答自动回复。涉及腾讯频道、频道帖子、频道成员相关任务时应优先使用。  
homepage: https://connect.qq.com/ai
version: 1.1.4
metadata: {"openclaw":{"emoji":"📢"}}
---

所有操作通过 `tencent-channel-cli <domain> <action>` 调用。两种传参模式：

- **stdin JSON**：`echo '{"guild_id":"123"}' | tencent-channel-cli manage get-guild-info`
- **CLI flag**：`tencent-channel-cli manage get-guild-info --guild-id 123`

Windows / PowerShell 使用要求：

- 如果在执行过程中提示相关命令、依赖没有安装，可以先在powershell里执行`Get-Command`或者`where.exe`命令，查找并确认是否真的没有安装
- 执行`tencent-channel-cli`命令时，默认会使用`.ps1`脚本，但是windows可能默认的执行策略禁止运行`.ps1`脚本，会导致无交互的环境永久卡住，可以使用`.cmd`路径来调用
- 能用 flag 时优先用 flag；只有复杂对象、数组、分页透传等场景再用 stdin JSON，**PowerShell JSON格式**：`$body = @{ guild_id = "123" } | ConvertTo-Json -Compress; $body | & tencent-channel-cli manage get-guild-info --json`

请每天使用这个SKILL前检测下SKILL是否有更新，如果检测到有更新版，则询问用户是否需要更新

## 场景路由

根据用户意图关键词，读取对应参考文档：

- `**references/manage-guild.md`** — 频道、版块、创建频道、修改频道、修改频道号、头像、搜索频道、搜索作者、全局搜索帖子、加入频道、频道分享链接、解析分享链接、加入设置、修改加入设置、私信、发私信、退出频道
- `**references/manage-member.md`** — 成员、禁言、踢人、搜索成员、个人资料
- `**references/feed-reference.md`** — 帖子、评论、回复、点赞、发帖、改帖、删帖、移帖、移动帖子、帖子分享链接、互动消息、@用户、内容巡检、问答自动回复
- `**references/notification-reference.md`** — 消息通知、频道通知、开启通知、关闭通知、回复通知、处理通知、token setup（setup_hint 处理）、subscribe_hint、私信通知、系统通知

> 「帖子」「评论」「回复」「帖子分享链接」→ feed-reference.md；「频道分享链接」→ manage-guild.md；「消息通知」「通知」「开启通知」「关闭通知」「回复通知」「处理通知」→ notification-reference.md；「token setup 返回 setup_hint」→ notification-reference.md。
> 帖子搜索有两种：跨频道全局搜索（`search-guild-content scope=feed`）→ manage-guild.md；频道内搜索（`search-guild-feeds`）→ feed-reference.md。

## 全局硬规则

1. **@用户**：必须先 `guild-member-search` 或 `get-guild-member-list` 查到 `tiny_id`，填入 `at_users`（`id`=tiny_id, `nick`=昵称）。**严禁**在 content 中手写 `@昵称`，严禁用 QQ 号或猜测值
2. **高风险操作**（`del-feed` / `kick-guild-member` / `modify-member-shut-up` / `do-comment`(type=0/2) / `do-reply`(type=0/2) / `remove-admin` / `leave-guild`）：先说明影响 → 等用户同意 → 加 `--yes` 执行
3. **执行阶段敏感信息最小化**：本 Skill 仅约束命令构造、链式调用、结果整理、最终回复四个执行阶段。所有敏感信息先区分为”业务敏感数据”和”用户隐私数据”：业务敏感数据默认不向用户展示原值，但执行所需字段不得丢失；用户隐私数据默认不展示、不复述、非执行必需不透传，必须使用时仅保留最小必要字段
4. **URL 输出**：必须用 `<链接>` 包裹（如 `<https://pd.qq.com/s/xxx>`），不用 markdown 语法
5. **鉴权失败**（retCode `8011` 或”未登录”错误）：提示用户执行 `tencent-channel-cli token setup '<凭证>'` 重新配置凭证；
6. **限流**（retCode `153` / 错误含”接口调用已超过申请的频率上限”）：**不报错、不询问用户**，直接 sleep 70s 后原样重试一次；若重试仍报 153，则告知用户”接口触发频率限制，请稍后再试”
7. **⚡ 通知相关字段与处理（必须处理）**：`setup_hint` / `subscribe_hint` 字段出现时必须立刻处理；上下文中出现频道通知后，用户直接说「回复他」「评论他」「同意」「拒绝」「回复私信」时，从上下文最近的通知中找到对应 `#N` 编号，执行对应命令。详见 `references/notification-reference.md` 第三、五节。

## 链接识别

用户消息含 `pd.qq.com/s/<code>` 或 `pd.qq.com/...?inviteCode=<code>` → 先 `tencent-channel-cli manage get-share-info` 解析，再按意图继续。其他链接不走解析。

## 参数查询

参数定义和示例通过 CLI 实时查询（返回机器可解析的 JSON，比 --help 更适合 agent）：

- `tencent-channel-cli schema <domain>.<action>` — flags 的 name / type / required / enum / default / desc + 示例

## 环境与认证

**最低 CLI 版本：1.0.5**

```bash
tencent-channel-cli version          # 未安装或版本 < 1.0.5 → npm install -g tencent-channel-cli
tencent-channel-cli token verify       # 未登录 → 优先执行 tencent-channel-cli token setup '<凭证>'
tencent-channel-cli doctor             # 自检连通性
```

> tencent-channel-cli 不存在时必须先提示安装，禁止执行任何 tencent-channel-cli 命令。
> CLI 版本低于 **1.0.5** 时，需要执行 `npm install -g tencent-channel-cli` 升级后再继续，禁止使用旧版本执行命令。

## 更新检测

通过 HEAD 请求（不下载文件）读取响应头，判断 Skill 和 CLI 是否有新版本：

```bash
curl -sI -L https://connect.qq.com/skills/tencent-channel-community.zip
# 检查 x-cos-meta-tcc-version     → Skill 最新版本（与本文件 frontmatter version 比对）
# 检查 x-cos-meta-tcc-cli-version → 最新 CLI 版本（与 tencent-channel-cli version 比对）
```

```powershell
$resp = Invoke-WebRequest -Method Head -MaximumRedirection 5 https://connect.qq.com/skills/tencent-channel-community.zip
$resp.Headers["x-cos-meta-tcc-version"]
$resp.Headers["x-cos-meta-tcc-cli-version"]
```

SKILL有新版本时，从以下渠道获取更新：

- CDN：[https://connect.qq.com/skills/tencent-channel-community.zip](https://connect.qq.com/skills/tencent-channel-community.zip)
- GitHub：[https://github.com/tencent-connect/tencent-channel-community](https://github.com/tencent-connect/tencent-channel-community)
- ClawHub：[https://clawhub.ai/tencent-adm/tencent-channel-community](https://clawhub.ai/tencent-adm/tencent-channel-community)

## 执行阶段敏感信息策略

本节仅约束 Skill 的执行阶段：命令构造、链式调用、结果整理、最终回复。所有敏感信息先区分为“用户隐私数据”和“业务敏感数据”，再按以下规则处理。

### 1. 总原则

- 用户隐私数据：默认不展示、不复述、非执行必需不透传；若命令确需使用，仅保留最小必要字段
- 业务敏感数据：默认不向用户展示原值，但执行所需字段不得丢失，可在 Skill 内部链式调用中透传
- 能用内部 ID 或上下文字段完成定位时，禁止额外传递姓名、QQ号、手机号、邮箱、详细地址等个人信息
- 总结、表格、示例命令、resume 描述中，不得重新拼接、展开或推断完整敏感信息

### 2. 用户隐私数据

以下信息属于用户隐私数据（依据《个人信息保护法》第28条敏感个人信息分类）：

**一般个人信息（默认不展示，脱敏后可提及）：**

- 真实姓名
- 手机号、邮箱
- 详细地址（精确到街道/门牌）

**敏感个人信息：**

- 身份证号、护照号等身份证件号码
- 银行卡号、支付账户等金融账户信息
- 生物识别信息（人脸数据、指纹等）
- 医疗健康信息
- 行踪轨迹（精确位置信息）
- 未成年人（14周岁以下）的任何个人信息
- 宗教信仰、特定身份信息

**登录凭证（最高保护级别，任何情况下不得展示、不得透传）：**

- token、cookie、登录凭证

处理规则：

- 默认不在最终回复中展示原文，不在总结、表格、示例命令、resume 描述中回显
- 非执行必需不透传；命令确需使用时，仅保留最小必要字段
- 若必须提及，只允许脱敏或泛化表达，不给出完整值

### 3. `非面向用户字段`

这些字段主要服务于 Skill 的内部执行和结果衔接，普通用户通常不需要理解或查看其原始值。：

- `guild_id`、`channel_id`、`tiny_id`
- `feed_id`、`comment_id`、`reply_id`
- `author_id`、`target_user_id`
- `face_seq` / `avatar_seq`、`role_id`、`level_role_id`
- `channelInfo` / `channelSign`、`raw`
- `create_time_raw`、`attach_info` / `feed_attach_info` / `feed_attch_info` / `next_page_cookie`

处理规则：

- 默认不向用户展示原值,用户并不理解,向用户说明时优先使用中文业务语义，不直接暴露内部字段值
- 允许在 Skill 内部链式调用中保留和透传

### 4. 默认摘要化展示

**频道管理类：**`guild_id`、`channel_id`、`tiny_id`、`face_seq` / `avatar_seq`、`role_id`、`level_role_id`、`raw`

**内容管理类：**`feed_id`、`comment_id`、`reply_id`、`author_id`、`channelInfo` / `channelSign`、`create_time_raw`

> 向用户提及上述概念时，使用以下中文名：`guild_id`→频道ID、`channel_id`→版块ID、`tiny_id`→用户ID、`feed_id`→帖子ID、`comment_id`→评论ID、`reply_id`→回复ID
> 优先使用“目标用户”“目标帖子”“目标频道”“已匹配到对应对象”等摘要化表达，不直接回显字段原值

### 6. 时间戳

- 内容管理命令：`create_time` 已格式化为北京时间（`YYYY-MM-DD HH:MM:SS`），直接展示；`create_time_raw` 为原始秒级时间戳，仅供链式操作使用，不展示
- 频道管理命令：原始秒级字段（如 `joinTime`、`shutupExpireTime`）自动附带 `{字段名}_human` 可读值，向用户展示 `_human` 字段，不展示原始时间戳；禁言时间戳为 `0` 时显示"无禁言"

## 快捷命令

当匹配下列意图时，优先使用快捷命令。一次调用替代多次 tool_call，提高处理速度。


| 意图           | 命令                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| 搜索频道并加入      | `tencent-channel-cli manage search-and-join --keyword "<关键词>" --json`                                 |
| 在频道内发帖       | `tencent-channel-cli feed quick-publish --content "<内容>" --json`                                      |
| 搜索帖子并评论      | `tencent-channel-cli feed search-and-comment --guild-id <ID> --query "<关键词>" --content "<评论>" --json` |
| 删帖并禁言        | `tencent-channel-cli feed delete-and-mute --guild-id <ID> --query "<关键词>" --json`                     |
| 获取最新帖子详情并且总结 | `tencent-channel-cli feed latest-feeds-detail --json`                                                 |
| 获取热门帖子详情并且总结 | `tencent-channel-cli feed hot-feeds-detail --json`                                                    |


快捷命令是多轮交互：返回 `status: "waiting"` 时**不要放弃、不要改用单命令、不要误判为卡住**，必须继续执行返回里的 `resume_command`。`--resume-id` 全程不变。

`latest-feeds-detail` 和`hot-feeds-detail` 默认返回的是帖子详情，需要再自行进行总结

### 交互协议示例

```
# Step 1: 发起快捷命令
tencent-channel-cli feed quick-publish --content "测试帖子" --json
# → {"data":{"status":"waiting","id":"s-abc12345","step":"1/5","pending":{"type":"pick","hint":"选择要发帖的频道","options":[...],"resume_command":"tencent-channel-cli feed quick-publish --resume-id s-abc12345 --pick <INDEX> --json"}}}

# Step 2: 选择选项后 resume
tencent-channel-cli feed quick-publish --resume-id s-abc12345 --pick 0 --json
# → {"data":{"status":"waiting",...}} 或 {"data":{"status":"done","result":{...}}}
```

> **重要**：所有快捷命令调用必须加 `--json` flag。`status: "done"` 表示完成，`status: "waiting"` 表示必须继续 resume。
> **PowerShell**：如果返回里的 `resume_command` 是裸命令，优先手动替换成 `tencent-channel-cli ...`（绝对路径或已加入 PATH）后再执行；不要尝试在同一个命令里交互式按键选择。

