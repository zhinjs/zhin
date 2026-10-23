# @zhin.js/plugin-content-moderation

内容安全审查插件 —— 入站 / 出站多源扫描，按可配置 severity→动作表处置。

## 安装

```bash
pnpm exec zhin install @zhin.js/plugin-content-moderation
```

## 配置

在应用目录运行安装命令，会安装依赖并挂载到 主配置 `plugins` 映射，实例名为 `content-moderation`。在 `zhin.config.yml` 的实例节点修改配置：

```yaml
configVersion: 2
plugins:
  content-moderation: "@zhin.js/plugin-content-moderation"
content-moderation:
  enabled: true
  onError: open # 源失败默认：open | closed
  maskChar: "*"
  replyTemplate: "消息含不当内容，已拦截。"
  masters: [] # 额外 master userId（兜底）
  inbound:
    enabled: true
    bypassMasters: true
    whitelist:
      userIds: []
      conversationIds: []
  outbound:
    enabled: true
    bypass: false # true 才跳过出站审查
  actions:
    # 可整表覆盖；缺省偏严
    pass: allow
    low: log
    medium: redact
    high: drop
    critical: [ drop, recall ]
  sources:
    - id: local
      type: local
      enabled: true
      includeBuiltin: true # 默认 true：合并内置分级词库
      defaultSeverity: high # 未标注分级的自定义词默认等级（兼容旧字段 severity）
      words:
        - 自定义敏感词 # → defaultSeverity
        - word: 擦边广告
          severity: low
        - word: 诈骗话术
          severity: high
      # wordFiles: ["./data/bad-words.txt"]
      # 词库文件行：word  /  severity:word  /  word|severity
      # - id: http-1
      #   type: http
      #   url: "https://example.com/moderate"
      #   onError: closed
      #   timeoutMs: 5000
      #   forceUpload: false
```



## 可选的自动群管理

默认关闭。`groupModeration` 逐项绑定适配器、endpoint 实例名、实际登录账号和群号；四项必须同时匹配，不能仅凭群号跨账号执行。

```yaml
content-moderation:
  groupModeration:
    - adapter: icqq
      endpoint: "your-endpoint-id"
      account: "your-bot-qq-number"
      group: "your-group-number"
```

复用已配置的 AI 文本补全服务、Database Host 原子持久状态和当前 generation 的适配器。当前 ICQQ 实现审核文字及近期文字上下文；纯图片内容不作为本流程的处罚证据。未配置 AI、持久状态或适配器群管接口时不执行自动处罚。

- 明确广告指未经请求的商业推广、交易或拉群引流。链接、技术分享、回应他人请求不能单独构成广告。
- 辱骂需结合上下文确认针对他人的人身攻击；观点批评、引用、举报和不明确的玩笑不直接处罚。模型必须提供当前原文中的证据；词库命中不参与处罚计数。
- 同一成员、同类违规按提醒 → 警告 → 禁言 10 分钟处理。只有上一条提示确认送达后新发送的消息才推进一级；30 分钟没有新违规重置。已执行禁言的这一轮不继续追加处罚。
- 实际入群时间在 10 分钟内的明确广告可直接踢出。缺少入群时间、消息早于本次入群、审核期间超过窗口或成员重新入群，都不能使用此例外；执行前重新读取平台权限与成员信息。
- 提醒或警告时，模型独立决定是否撤回这条违规原消息，并给出理由；不按处罚级别固定撤回。代码固定消息、群和账号，模型无法另选目标。对已明确评估的广告/辱骂，原词库动作不会再覆盖撤回决定；其他消息仍按原有词库配置处理。
- 原群内简短说明规则和处理结果，不复述广告链接或辱骂。撤回失败不重试、不增加违规次数；通知未确认送达、处罚结果未知或进程在副作用中断时，保留持久执行预留，阻止重复处罚。该预留最多保留 30 分钟。
- 普通 `group_kick` 工具仍逐次要求人工审批；无人工审批渠道时拒绝，不扩大自动例外。

审核不携带工具，聊天内容作为不可信数据传入，调用计入现有用户/群配额。近期上下文在 generation 内有界保存（最多 50 条、12,000 字符）；单条超出处理预算、缺少可靠时间、取消或审核失败时不处罚。这些限制属于处理能力边界，不是新的违规阈值。实际部署前应以本群样本验证模型对广告、引用、玩笑和正常分享的区分；单元测试不能证明模型判断准确。

## 动作说明（`actions`）

扫描得到最终 severity 后，查 `actions.<severity>` 得到一个动作或动作列表（可叠加）。  
不调用 `next()` = 中断中间件链：入站不进入命令/Agent；出站不发给平台。


| 动作       | 入站（inbound）                                                                              | 出站（outbound）                                                                                  |
| -------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `allow`  | 放行（调用 `next()`）                                                                          | 放行                                                                                            |
| `log`    | 打结构化审计日志后**继续**（可与其它动作叠加；非 `pass` 时引擎也会记一条）                                              | 同左                                                                                            |
| `reply`  | 用 `replyTemplate` 回复发送者；是否继续取决于是否同时有 `drop` / `redact`                                   | **不适用**（忽略并 debug 日志）                                                                         |
| `redact` | Runtime `Message` 只读，**无法改写原文**；仍 **正常** `next()` **放行**（可与 `reply` 叠加做提示）。若要拦截请用 `drop` | 对 payload **真打码**：命中 span 用 `maskChar` 替换；无 span 则整段打码；违规图段删除；然后 `envelope.replace` 并**继续发送** |
| `drop`   | 丢弃：不 `next()`，命令/Agent 看不到该消息                                                            | 丢弃：不 `next()`，消息不会发出                                                                          |
| `recall` | 尝试撤回原消息（`OutboundHost.recall`）；无 message id / 平台不支持 → 降级并 warn                           | 发送前无意义，**忽略**                                                                                 |




### 叠加与中断规则

- 配置写成数组即可叠加，例如 `critical: [drop, recall]`：先按列表执行副作用，再决定是否放行。
- **中断（不** `next()`**）**：含 `drop`；或入站含 `recall`（且无 `allow`）。
- **继续**：`allow` / `log` / `reply` / `redact`（入站 redact 不改原文但放行；出站 redact 先 `replace`）。



### 偏严默认表


| severity   | 默认动作             | 实际效果简述                      |
| ---------- | ---------------- | --------------------------- |
| `pass`     | `allow`          | 放行                          |
| `low`      | `log`            | 只记日志，照常处理                   |
| `medium`   | `redact`         | 入站放行（不改原文）；出站打码后发出          |
| `high`     | `drop`           | 入站丢弃；出站不发                   |
| `critical` | `[drop, recall]` | 入站丢弃并尽量撤回；出站不发（`recall` 忽略） |


示例：入站 medium 想「提示但仍放行」，在 `content-moderation.actions` 中修改：

```yaml
actions:
  medium: [redact, reply]
```

若入站要拦截，请用 `drop`（或 `high` 默认表）。

## 本地词库分级


| 等级         | 内置示例（节选）  | 默认动作              |
| ---------- | --------- | ----------------- |
| `low`      | 轻度不当用语    | `log`             |
| `medium`   | 辱骂粗口      | `redact`          |
| `high`     | 色情/诈骗引流；中国政治敏感（台独/藏独、六四相关、法轮功等） | `drop`            |
| `critical` | 毒品/极端违法；煽动暴力颠覆 | `drop` + `recall` |


命中多词时取**最高** severity。自定义词可覆盖同词更高等级。不需要政治词库时设 `includeBuiltin: false` 并自建 `words` / `wordFiles`。

## 其它行为


| 方向  | 扩展点                             | 说明                               |
| --- | ------------------------------- | -------------------------------- |
| 入站  | `middlewares` `target: inbound` | master / 白名单可跳过                  |
| 出站  | `target: outbound`              | 默认仍审；`outbound.bypass: true` 才跳过 |


- 多源全跑，取最高 severity。
- 图片：HTTP 源优先传 URL；不可达或 `forceUpload` 时下载后上传。
- 审计：仅结构化 logger（无落库）。



## HTTP 源契约

`POST` JSON（或 multipart）：

```json
{
  "text": "...",
  "images": [{ "url": "https://..." }],
  "direction": "inbound",
  "context": {
    "adapter": "...",
    "endpoint": "...",
    "conversationKind": "group",
    "conversationId": "...",
    "sender": "..."
  }
}
```

响应：

```json
{
  "severity": "medium",
  "matches": [{ "start": 0, "end": 2 }],
  "images": [{ "index": 0, "flagged": true }],
  "reason": "optional"
}
```



## 许可

MIT
