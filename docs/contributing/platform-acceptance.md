---
title: 平台稳定认证
---

# QQ 官方、Telegram 与 OneBot 路径的稳定认证候选

首批覆盖 QQ 官方、Telegram、OneBot11 与 NapCat，前三者保持 **Advanced**，NapCat 保持 **Experimental**。`pnpm check:platform-candidates`
执行离线契约测试。四者已通过 `scripts/adapter-meta.mjs` 的 `stabilityCandidate`
进入 `pnpm check:stable`，先积累与 Stable 核心相同的 CI 回归记录，再按证据升档。
候选标记不改变公开档位；未来升为 `PlatformStable` 后，即使移除候选标记也继续运行平台测试。

## 渐进推进

1. **首批：NapCat / OneBot11、QQ 官方、Telegram**。先稳定常用收发、账号隔离、停机与恢复路径，修正文档并持续跑门禁。
2. **按模式验收**。分别记录 NapCat / OneBot11 正反向 WS、NapCat HTTP、QQ WebSocket / HTTP、Telegram Polling / Webhook 的证据；未覆盖的模式明确保留限制，不用单个模式的结果代表整个平台。
3. **再扩展其他 Advanced**。每次选一个平台，补齐同样的生命周期、消息回执、隔离与故障测试，再加入候选；不按适配器数量一次性改标签。

首批离线改进已落地；2026-09-30 用户已确认四个平台真实账号的文本探针收发通过，并提供接收端截图。网络恢复、其他能力与持续运行记录仍待取得。
候选与已认证平台测试由 SSOT 自动选择，缺少测试目录或空测试目录会让 Stable 门禁失败。

## 按接入模式记录证据

新增 NapCat / OneBot11 的 QQ 常用路径，与现有 QQ 官方、Telegram 候选并行推进。
每项验收必须对应具体模式及桥/SDK 版本。以下是真实平台证据的待验矩阵，不能由模拟测试自动改为通过：

| 平台 | 模式 | 当前真实认证状态 |
| --- | --- | --- |
| NapCat | 正向 WS | 真实文本探针收发通过（用户确认与接收端截图）；完整认证待验 |
| NapCat | 反向 WS、HTTP | 待用户实机验证 |
| OneBot11 | 正向 WS | 真实文本探针收发通过（用户确认与接收端截图）；完整认证待验 |
| OneBot11 | 反向 WS | 待用户实机验证 |
| QQ 官方 | WebSocket | 真实文本探针收发通过（用户确认与接收端截图）；完整认证待验 |
| QQ 官方 | HTTP 回调 | 待用户实机验证 |
| Telegram | Polling | 真实文本探针收发通过（用户确认与接收端截图）；完整认证待验 |
| Telegram | Webhook | 待用户实机验证 |

共享离线契约包括传输状态与 generation 准入分离、旧 socket 回执隔离、候选事件可靠确认、
发送结果未知时禁止无条件重发。`connected` 只证明本地可观察的传输就绪；平台审核 ID、
文件 ID 或脚本生成的 ID 不证明消息已投递。`failure.deliveryUnknown` 表示平台可能已接受，
人工验证之前不要把它当作可以安全重试的失败。

建议先进行 24h 初验，再进行 72h 升档候选长跑；这不是已有实机通过记录。
报告应包含样本量、发送确认/未知/拒绝、重复、恢复时间分布及资源趋势；
不支持、环境未准备、失败分别记录为 unsupported、blocked、failed。

打包安装门禁、真实账号探针与长跑操作步骤见[平台验收执行器](./platform-acceptance-runner.md)。

## 真实鉴权预检

```bash
pnpm check:platform-auth --project examples/test-bot --report /tmp/platform-auth.json
```

显式执行时读取项目 `.env`（当前进程环境变量优先）与 `zhin.config.yml`。
仅验证 QQ 官方 token / 网关发现和 Telegram `getMe`，不发送消息、不注册 Webhook、不启动 Bot。
Telegram 尚未配置端点时，也可使用 `.env` 中的 `TELEGRAM_TOKEN` / `TELEGRAM_BOT_TOKEN` 完成鉴权预检。
报告使用端点索引，不包含 token、账号 ID、响应正文；报告路径必须尚不存在。
报告同时记录 HEAD 与工作区是否存在未提交修改。配置解析失败仅返回通用错误，不回显配置文本。
脱敏契约由 `tests/docs/platform-auth.test.ts` 验证（全部使用模拟 HTTP，不需要真实凭据）。
此命令不加入 CI，也不等同于消息收发、网络恢复或长时间运行验收。

## 已有自动化覆盖

| 项目 | QQ 官方 | Telegram |
| --- | --- | --- |
| 入站归一与出站 | 私聊、群、频道、媒体与平台回执 | 私聊、群、频道、媒体与平台回执 |
| 故障反馈 | SDK 失败、审核拒绝、缺少消息 ID 时拒绝成功 | 403/429/500 不自动重发；缺少有效消息 ID 时拒绝成功 |
| 生命周期 | 关闭时拒绝入站、停机释放 SDK、两个账号隔离与迟到事件 | 关闭时拒绝入站、停机中止长轮询、重复启动不重复轮询、持续失败退避、退避监听器回收、取消后迟到批次不派发、入站权限查询跨关闭/重启隔离与双账号缓存隔离 |
| Webhook | 签名、回调与 Host 路由测试 | secretToken 校验与 Host 路由测试 |
| 框架共享契约 | AdapterIndex generation 与 Endpoint lifecycle 测试 | 同左 |

具体断言在 `plugins/adapters/qq/tests/`、`plugins/adapters/telegram/tests/` 和
`packages/im/adapter/tests/`；这些证据不等同于真实平台验收。

## 升档前仍需取得的证据

- 在专用测试账号/会话验证私聊与群聊文本、引用、图片、撤回及支持的交互段；记录平台限制。
- 两个账号同时运行，验证入站、回复、权限和持久化不会串号。
- 实际断网和恢复、平台限流/权限拒绝、SDK 重连，验证恢复时间和停止后无重连。
- 收发过程中热重载与生产重启，核对丢失、重复、迟到事件；单列重复 Webhook/更新重投的处理语义。
- 明确发送超时后的未知结果及人工处理方式，不能通过无条件重试产生重复消息。
- 保留连续运行观察记录，包含消息成功率、延迟、错误类型和资源变化。

每份验收记录至少包含 commit、适配器与 SDK 版本、Node/OS、接入模式、UTC 时间、
逐项结果与脱敏日志/回执路径、执行人与未覆盖项。凭据和真实聊天内容不入库。
仅用测试账号及已授权的目标会话；真实平台操作须限定在已授权的测试会话中。

所有必需项得到证据后，再按仓库稳定档位规则评审并更新 `scripts/adapter-meta.mjs`，
将被认证的平台测试纳入 `check:stable`。不能因离线候选测试通过就自动升档。
