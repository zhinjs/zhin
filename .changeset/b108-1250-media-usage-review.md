---
"@zhin.js/agent": patch
"@zhin.js/harness": patch
---

**识图与委派媒体（审查跟进）**：委派只在明确要求时附带原始媒体，识图每次请求单独计数（#1250）。

- `ask` / `delegate` 新增可选参数 `attach_media`（默认 `false`）：只有委派方明确要求时，用户本回合的原始图片 / 视频 / 文件才随请求交给对方 Agent。每个 Agent 每个根回合最多收一次，每个根回合合计最多 8 项、20 MiB，不再占用根回合的 `inspect_image` 识图额度；每项只下载 / 读盘一次；语音不交，入口 Agent 不收。有识图描述的协作回合，框架说明会提示可以用这个开关。`@zhin.js/harness` 的 `ask` / `delegate` 邮件体与 `SendRequest` 相应多出 `attachMedia`。
- 识图预处理按请求逐次上报：备用链上每个候选的每次请求各记一次调用（provider 为服务 id、模型、结束原因 `stop` / `error` / `aborted`、用量），失败、取消时正在进行的请求也记。失败、取消或供应商没回报用量时，配额按估算扣，trace / `[ai.usage]` / `agent_usage_calls` 把这次的 token 标为未上报（`?` / `NULL`），不再当成供应商数字；识图成功但没有用量时也算一次调用。`MediaPerceptionPort.describe()` 多一个可选的逐次回调参数，`MediaPerceptionFailedError` 的 `provider` / `model` 换成 `calls`。
- 拒绝原因更准：本机路径超过上限（即使没声明大小）记 `too_large`，类型不符记 `mime_mismatch`，出站 path 同样区分；平台引用缺引用键 / 解析器或解析失败走统一的 `inbound_media_rejected`（`unmaterialized_platform_reference`）。委派附带媒体被拒时，日志同样带根回合的 `scene` 与消息 id。
- trace 里的识图描述与识图服务 / 模型去掉终端控制字符，`zhin trace` 输出不会被描述里的 ANSI / OSC 序列操控。
- 用量存储改在回合的错误处理内读取：租约失效时照常结束并保存 trace。
