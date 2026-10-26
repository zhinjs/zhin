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
  # 省略 replyTemplate 时跟随本次消息语言；填写后原样使用，不自动翻译。
  # replyTemplate: "消息含不当内容，已拦截。"
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
- 原群内通过 @ 对应成员简短说明规则和处理结果，不复述广告链接或辱骂。撤回失败不重试、不增加违规次数；通知未确认送达、处罚结果未知或进程在副作用中断时，保留持久执行预留，阻止重复处罚。该预留最多保留 30 分钟。
- 普通 `group_kick` 工具仍逐次要求人工审批；确认信息展示本次群、成员和操作参数，并将执行参数固定为该次确认的快照。无人工审批渠道时拒绝，不扩大自动例外。

上下文按消息到达顺序记录；同一成员的不同消息可独立审核，处罚和通知仍通过持久预留避免并发执行。重复投递只复用原消息的审核状态，不另行撤回仍在等待判断的原消息。通知确认并保存进度后释放预留，可选撤回不会占用下一次处罚的预留。审核接受完整 JSON 对象及其 Markdown 代码块包装；无法解析或缺少有效证据时记录诊断，不猜测结论或自动重试。

匹配范围内的有效文字先进入群审核队列。空闲时从第一条起最多收集 300 ms；同场景、同用户每批最多 4 条，一次模型调用最多 8 个用户批次（32 条原消息），达到批次容量提前提交。调用期间继续收集，当前批处理结束后立即取积压消息，不再额外等待收集窗口。请求保留全群到达顺序及各消息之前的上下文，模型逐条返回判定，处罚进度仍按原消息及通知送达时间处理。

通过现有拦截的普通聊天和命令不等待群审核；因此可能先回复、后处置。权限检查、工具审批和出站规则照常执行。词库若准备撤回，仍等待该原消息的模型决定，防止模型决定保留而词库提前删除。每群待审缓冲最多 128 条、256 KiB 原文；新消息会超过任一上限时，跳过本条模型审核并记录 `group_review_skipped`（`reason: queue_full`），仍执行既有词库和权限规则。空位恢复后正常接纳，不建立额外等待区，也不自动补审跳过的消息。容量上限不包含当前执行的批次和有限历史上下文；超载期间可能漏审，日志不能视为已审核。

多人共用模型调用时，按各人原文估算 token 比例分摊用量，共享提示词和输出也按此比例归属；群 token 不重复累加，群请求只记一次。个人超额只排除本人并重建请求，群超额则不调用；估算分摊并非 provider 提供的精确个人用量。调用失败沿用输入用量预留，不自动重审整批。合批使用所配置模型的输出预算；结果截断时整批记录失败，不猜测结论。旧版或自定义 AI 服务未声明支持多人用量归属时，沿用逐条审核及原来的个人计量，避免静默漏记用量；不同 completion 资源的消息不会合入同一请求。

队列随插件资源与适配器生命周期取消，旧任务不能在热重载后继续处罚；不持久保存或重放未审任务。通知走 owner-scoped Outbound Host 和统一出站链路，不保留已经结束的原消息回复回调。规则提示使用原消息进入队列时的语言，等待审核期间切换语言不会改变该次通知；模型理由、证据和自定义模板保持原文。300 ms 仅为收集上限，排队、模型和平台调用会增加处置延迟；新人自动踢出的 10 分钟窗口不会因排队延长。

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
