---
"@zhin.js/agent": patch
"@zhin.js/harness": patch
---

**识图与委派媒体（审查跟进）**：委派只在明确要求时附带原始媒体，识图每次请求单独计数（#1250）。

- `ask` / `delegate` 新增可选参数 `attach_media`（默认 `false`）：只有委派方明确要求时，用户本回合的原始图片 / 视频 / 文件才随请求交给对方 Agent。每个 Agent 每个根回合最多收一次，每个根回合合计最多 8 项、20 MiB，不再占用根回合的 `inspect_image` 识图额度；同一项在本根回合的多次委派之间只下载 / 读盘一次，已知大小放不下的项不先下载，没交出去的项不留缓存；语音不交，入口 Agent 不收。子回合失败或被取消（包括在读取媒体时被取消，此时不再等读取完成）时附带作废、名额退回，同一 Agent 重试仍能拿到。请求了却没附上（对方模型不收该类型、已附带过、超出上限、读不到、对方是入口 Agent）时，`ask` / `delegate` 的工具结果注明 `[Media not attached to …: 原因]`。有识图描述的协作回合，框架说明会提示可以用这个开关。`@zhin.js/harness` 的 `ask` / `delegate` 邮件体与 `SendRequest` 相应多出 `attachMedia`。
- 识图预处理按请求逐次上报：备用链上每个候选的每次请求各记一次调用（provider 为服务 id、模型、结束原因 `stop` / `error` / `aborted`、用量），失败、取消时正在进行的请求也记。失败、取消或供应商没回报用量时，配额按估算扣，trace / `[ai.usage]` / `agent_usage_calls` 把这次的 token 标为未上报（`?` / `NULL`），不再当成供应商数字；识图成功但没有用量时也算一次调用。回合在识图进行中被取消时，已发出的请求按估算扣配额（只扣一次）。`inspect_image` 对本机图片的识图同样逐次计数（取消时已发出的请求也记）。识图描述的 `provider`（trace `media[].provenance`）与该请求在 `model_calls` 里的服务 id 一致。`zhin trace` 把没有上报用量的调用的输入 / 输出显示为 `?`，合计注明「含估算」。`MediaPerceptionPort.describe()` 多一个可选的逐次回调参数，`MediaPerceptionFailedError` 的 `provider` / `model` 换成 `calls`；包根新增导出 `MediaPerceptionCall` 类型与 `MediaPerceptionFailedError`。
- 拒绝原因更准：本机路径超过上限（即使没声明大小）记 `too_large`，类型不符记 `mime_mismatch`，出站 path 同样区分；平台引用缺引用键 / 解析器或解析失败走统一的 `inbound_media_rejected`（`unmaterialized_platform_reference`）；解析器判定失败时，占位与回合结局保留解析器的具体码。委派附带媒体被拒时，日志同样带根回合的 `scene` 与消息 id。
- trace 里的识图描述与识图服务 / 模型去掉终端控制字符，`zhin trace` 输出不会被描述里的 ANSI / OSC 序列操控。
- 用量存储改在回合的错误处理内读取：租约失效时照常结束并保存 trace。
