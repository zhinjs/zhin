# @zhin.js/plugin-content-moderation

内容安全审查插件 —— 入站 / 出站多源扫描，按可配置 severity→动作表处置。

## 安装

```bash
npm install @zhin.js/plugin-content-moderation
```

## 配置

在 `zhin.config.yml` 中添加：

```yaml
plugins:
  - "@zhin.js/plugin-content-moderation"

content-moderation:
  enabled: true
  onError: open                 # 源失败默认：open | closed
  maskChar: "*"
  replyTemplate: "消息含不当内容，已拦截。"
  masters: []                   # 额外 master userId（兜底）
  inbound:
    enabled: true
    bypassMasters: true
    whitelist:
      userIds: []
      conversationIds: []
  outbound:
    enabled: true
    bypass: false               # true 才跳过出站审查
  actions:                      # 可整表覆盖；缺省偏严
    pass: allow
    low: log
    medium: redact
    high: drop
    critical: [drop, recall]
  sources:
    - id: local
      type: local
      enabled: true
      includeBuiltin: true          # 默认 true：合并内置分级词库
      defaultSeverity: high         # 未标注分级的自定义词默认等级（兼容旧字段 severity）
      words:
        - 自定义敏感词                 # → defaultSeverity
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
    #   timeoutMs: 5000outbound
    #   forceUpload: false
```



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


示例：入站 medium 想「提示但仍放行」，可改成：

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