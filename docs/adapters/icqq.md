---
title: "@zhin.js/adapter-icqq"
package: "@zhin.js/adapter-icqq"
tier: Advanced
---

::: info 文档同步
本页由 [`plugins/adapters/icqq/README.md`](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq/README.md) 自动生成。请修改包内 README 后运行 `pnpm sync:adapter-docs`。
:::

<!-- sync-adapter-docs:sha256=71d0b61e47eed0db -->

# @zhin.js/adapter-icqq

ICQQ Plugin Runtime 适配器 — 进程内直接使用 [@icqqjs/icqq](https://github.com/icqqjs/icqq) `Client`

## 功能特性

- 群聊 / 私聊 / 群临时会话 / QQ 频道消息
- 入站：ICQQ Client 原始事件经 `endpoint[endpointSpec].events` 唯一入口上送；文本与图片 / 语音 / 视频 / 文件统一归一为 canonical `Segment` + `MediaRef`
- 出站：canonical Segment 直接投影为 ICQQ 原生 `Sendable`，再由 `sendGroupMsg` / `sendPrivateMsg` / …发送
- 群聊 reaction：`control.addReaction` / `removeReaction`（协议 ACK 失败不阻塞后续发送）
- Agent 工具：按职责拆分在 `agents/icqq/skills/icqq-*/tools/`，只在对应 Skill 激活后披露
- Console Endpoint 管理：`src/endpoint.ts` 显式实现 `EndpointManagement`（好友/群/群成员列表、请求审批、删好友、踢人、禁言、设管理）

## 安装

```bash
pnpm add @zhin.js/adapter-icqq @icqqjs/icqq
# 可选：未配置 signApiAddr 时走本地签名
pnpm add @icqqjs/qqsign
```

`@icqqjs/icqq` 是适配器的**可选对等依赖**（`peerDependencies` + `optional`）。应用侧需自行安装；monorepo 内另在 `devDependencies` 声明以便构建/测试。

`@icqqjs/*` 发布在 GitHub Packages，需：

```ini
@icqqjs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

并设置具有 `read:packages` 权限的 `NPM_TOKEN`（CI 使用仓库 secret `PERSONAL_TOKEN`）。

签名：未配置 `signApiAddr` 时，若已安装 `@icqqjs/qqsign` 则自动走本地签名。

## 前置条件

1. 准备可登录的 QQ 账号，并选择远程 `signApiAddr` 或安装本地 `@icqqjs/qqsign`。
2. 确保运行目录可持久化设备与登录状态；容器部署应挂载对应数据目录。
3. 首次登录可能要求二维码、滑块或设备确认，可在 Console 登录待办或终端完成。

## 配置（Plugin Runtime）

```yaml
configVersion: 2
plugins:
  icqq: "@zhin.js/adapter-icqq"
icqq:
  master: "1659488338" # 必填，顶层共享（/approve 与 master 角色）
  autoReconnect: true
  endpoints:
    - id: "${ICQQ_ACCOUNT}" # QQ 号
      # password: "${ICQQ_PASSWORD}"  # 可选；不填则扫码登录
```

多账号：一个插件实例挂多个 endpoint（`endpoints` 数组逐项覆盖顶层字段，`id` 必填）：

```yaml
configVersion: 2
plugins:
  icqq: "@zhin.js/adapter-icqq"
icqq:
  master: "1659488338"
  endpoints:
    - id: "${ICQQ_ACCOUNT}"
    - id: "${ICQQ_ACCOUNT_2}"
    - id: "${ICQQ_ACCOUNT_3}"
```

`AdapterIndex` 会先合并插件实例默认值与 endpoint 覆盖值，再把一份完整配置交给
ICQQ adapter。协议层只接受这份展开后的 endpoint 配置，不读取环境变量，也不再次解析
嵌套的 `endpoints`。环境变量替换由 composition root 在配置加载阶段完成。

## Send conversation

| 类型 | conversation |
|------|--------------|
| 私聊 | `{ kind: 'private', id: uin }` |
| 群聊 | `{ kind: 'group', id: gid }` |
| 群临时会话 | `{ kind: 'private', id: uin, parent: { kind: 'group', id: gid } }` |
| 频道 | `{ kind: 'channel', id: channelId, parent: { kind: 'channel', id: guildId } }` |

## 直接使用完整 ICQQ Client

适配器把 `icqq` 注册为 `@icqqjs/icqq.Client` 与 SDK `EventMap` 的类型判别项。
所有 Feature 都使用同一个 `adapter` 字段完成类型缩窄与运行时过滤：

```ts
import { defineHandler } from 'zhin.js/handler'
import '@zhin.js/adapter-icqq'

export default defineHandler({
  adapter: 'icqq',
  event: 'request.group.add',
  async handle({ client, event }) {
    await client.setGroupAddRequest(event.flag, true)
  },
})
```

原生 Handler 参数中的 `client` 就是当前账号的真实 ICQQ SDK 实例，`event` 保留同一原生事件对象、原型和方法。消息操作的 `session.endpoint`、`session.event` 与 `session.adapter` 分别提供同一个实际 Endpoint、原始消息事件和所属 Adapter。未知扩展事件可显式使用
`event: '*'`；此时 Client 类型保持完整，事件 payload 为 `unknown`。普通消息回复仍应走
`Message.$reply`；群管理、请求审批与 ICQQ 专属查询可直接调用当前 Session 的 Endpoint。

Command context 的 `$client` 是按需读取的 getter：

```ts
export default defineCommand({
  adapter: 'icqq',
  async execute(context) {
    await context.$client.sendLike(Number(context.sender!.id), 10)
    return 'ok'
  },
})
```

Middleware 使用同一个判别字段；不声明 `adapter` 时 `$client` 的类型是 `unknown`：

```ts
export default defineMiddleware<Message>({
  target: 'inbound',
  adapter: 'icqq',
  async handle(context, next) {
    console.log(context.$client.uin, context.input.content)
    await next()
  },
})
```

Agent tool 的 IM turn 同样直接读取当前 Client：

```ts
export default defineAgentTool({
  adapter: 'icqq',
  description: '获取群列表',
  async execute(_input, context) {
    return context.$client.getGroupList()
  },
})
```

`adapter` 缺失时 `$client` 静态类型为 `unknown`；声明后若实际 operation 不属于 ICQQ，
运行时会在执行前拒绝。Client 只能在当前 operation 内使用。task、schedule 或 Host 等脱离
IM turn 的场景，应通过 Host 提供的显式账号作用域操作，不能缓存旧 Client 或从另一个可写目录选择账号。

## 架构

- `plugin.ts` + `adapters/icqq/index.ts`：Plugin Runtime 入口与 `defineAdapter` 声明
- `src/endpoint.ts`：继承真实 ICQQ `Client`，只协调账号 transport、Zhin lifecycle 与各能力端口
- `src/content-resolver.ts`：保存已观察消息，并按深度和条数限制递归展开合并转发
- `src/icqq-inbound.ts`：把 ICQQ 原生消息归一为 Zhin 入站消息
- `src/protocol.ts`：配置解析、会话映射与出站目标转换
- `src/client.ts`：从原生 SDK 推导事件类型，并将实际 `IcqqAdapter` 注册到唯一 `AdapterRegistry`
- Agent 工具：`agents/icqq/skills/icqq-*/tools/<name>/index.ts`；权限说明见 `PERMITS.md`

阅读适配器实现时从 `endpoint.ts` 看能力装配，再进入对应能力文件。包外代码只从
`@zhin.js/adapter-icqq` 与 `zhin.js/adapter` 的公开入口导入，不依赖上述源码路径。

## Plugin Runtime 迁移说明

- 不再经过 `@icqqjs/cli` IPC 守护进程；登录态与协议栈都在本进程。
- `autoReconnect`：Client 断线后按配置自动重连（`stop()` 为主动断开，不触发重连）。
- `outboundMedia: file | base64`：`file` 在发送期间把 segment base64 物化为临时文件并于发送结束清理；`base64` 使用 ICQQ 原生支持的 `base64://` file 参数。
- ICQQ 的语音、视频、文件是独立消息元素；它们与其他段混发时适配器会明确拒绝，避免协议栈静默丢段。
- 入站语音 / 视频在 Endpoint 持有原生 Client 时解析可下载 URL；解析失败则保留真实平台引用，不伪造或丢弃媒体。
- **Console 社交/群管 RPC 已接线**：endpoint 把好友/群/群成员列表、请求审批和群管操作归一化为冻结的 `EndpointManagement`。Host 只消费该语义端口。
- 好友/入群请求与通知：经 the unified `endpoint[endpointSpec].events` ingress 分发到 `handlers`（`notice.receive` / `request.receive`）；审批走 `Request.$approve` / `EndpointManagement.approveRequest`。Console `request.list` 优先读 `management.listRequests()`（`getSystemMsg`），不再写入 `unified_inbox_request/notice`。
- `system.*`（登录扫码等）分发到 `system.receive`。
- **登录辅助**：每次登录是一条登录流程（[ADR 0058](https://zhin.js.org/adr/0058-login-assist-v2)），`system.login.qrcode|slider|device|auth` 变成流程里的挑战，Console、终端和 QQ 命令都能作答，见下文「登录」。

## Agent 会话与消息操作

ICQQ Agent 可按需加载 `icqq-conversation` 查询当前群／频道和 Bot 自身角色。`icqq-messages` 提供当前会话的引用回复、真实消息合并转发和撤回自己发言；自己的消息撤回不要求群管身份或逐次审批，时限由平台决定。

`icqq-group-admin` 新增撤回他人消息与退群：前者保留群管发起权限、实时平台角色检查，无需逐次审批；退群仅主人可发起、每次审批，Bot 为群主时拒绝执行。引用／转发走统一发送链路，不支持跨会话转发。`set_group_admin` 设置／取消管理员仅在 Bot 为当前群群主时注入，每次人工审批并实时复核角色。当前 guild-channel 接入仅提供身份查询，不能使用这些群／私聊操作。详见 [权限与能力说明](https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq/PERMITS.md)。

## Console 页面

启动后打开 Console 的「ICQQ」页（地址 `/icqq`），可以：

- 查看运行中的连接、点「测试连接」做连通性诊断；
- 在账号库保存、修改、启动、停止、替换或删除该 Adapter 的账号；新增仅保存，不创建 SDK Client，需手动启动；
- 处理登录（扫码、滑块、设备锁、短信、身份验证），并「重新登录」或「刷新二维码」；

ICQQ 首次登录的二维码、滑块、设备锁会出现在「登录待办」里，不需要再回到终端确认。

读取需要 `icqq:read`（`read` 级别，内置角色 `viewer` 及以上都有）；增删改账号等写操作需要 `icqq:write`（`operate` 级别，`operator` 及以上都有，绑定到本适配器的角色也算），首次迁移还需管理员身份；全局所有者不受限，见[插件权限的级别](https://zhin.js.org/console/#插件权限的级别)。页面里的「添加 endpoint」等价于原来的 `icqq endpoint add`。

首次修改启动配置里的既有账号前，管理员必须核对清单并确认一次迁移。原 canonical 身份与历史保留，完整账号配置加密进入 Host 数据库；此后账号管理只写数据库，不修改启动文件或 `.env`，不重启进程。没有持久化账号端口的环境可使用静态配置连接，动态写操作明确不可用。

启停意图在进程重启后恢复。停止或删除会取消并关闭目标账号的在途操作，其他账号继续运行；删除保留历史。已启动账号的连接配置更新先关闭旧 incarnation，再仅重连该账号；平台身份变化按替换处理，分配新内部身份、保留旧历史，新账号不继承旧 Session、个人设置或启动意图。提交结果未知时先刷新核实，不自动重复 CAS 或平台操作。

## 登录

适配器声明 `login: { mode: 'interactive', challenges: ['qrcode', 'slider', 'device', 'auth', 'sms'], relogin: true, refreshQr: true }`。每次登录尝试是一条登录流程：连接 → 挑战 → 验证中 → 在线或失败。提交后能看到真实结果（验证码错误、太频繁、已过期等），不再是「提交了就没消息」。

| 挑战 | 怎么完成 |
|------|----------|
| 扫码登录 | 用手机 QQ 扫码，再在手机上确认。扫码后时间线显示「已扫码，请在手机上确认登录」，确认后自动继续；没有继续时点「我已确认登录」。二维码过期会自动换新的（最多两次），之后点「刷新二维码」。 |
| 滑块验证 | 在 Console 打开验证码辅助页（默认 `https://zhin.js.org/login-assist/tcaptcha.html`，可用 `console.loginAssist.captchaHelperUrl` 换成自己的页面），完成后自动提交，不需要开发者工具。手动方式：打开滑块链接，按 F12 在「网络」面板找到 `cap_union_new_verify` 的响应，复制 `ticket`，或者直接粘贴整段响应 / 带 ticket 的链接，会自动提取。 |
| 设备锁 | 用手机 QQ 扫验证链接的二维码（或在手机上打开链接）完成验证，再点「我已在手机完成验证」。SDK 给出密保手机时可以点「改用短信验证码」：发送验证码后输入 6 位数字，「重新发送」要等 60 秒（按账号计，重新登录也不清零）。不点就不会发短信。只能输入文字的旧版 Console、终端里输入 `sms` 同样表示改用短信。 |
| 身份验证 | 按步骤：① 复制设备 JSON；② 打开验证链接，进入发送验证码的页面；③ 在该页开发者工具 Console 运行辅助脚本（也可拖到书签栏），按提示粘贴 JSON；④ 完成后点「已完成，继续登录」。不要把设备 JSON 粘贴到其他网站或发给他人。 |

细节：

- **滑块提交格式**：NT 登录（SDK 的 `sig.nt_captcha` 指向这个滑块）提交 `ticket,randstr`，缺 randstr 时会提示并留在滑块；旧版 wtlogin 只提交 `ticket`。
- **验证链接**带会话标识（sid / sig），密保手机号也算敏感信息：
  - Zhin 自己的日志和 `system.receive` 副事件只有挑战类型和链接的主机名（`{ kind, host }`），不含链接、手机号、设备信息和二维码图片；`login.error` 只带错误码和清洗后的说明。
  - icqq SDK 自己的日志（log4js，`mark` 级别会打印滑块、设备锁、身份验证链接和手机号）经适配器包装：链接只保留到路径（查询串变成 `?…`），手机号变成 `***`。
  - **未覆盖**：SDK 绕过日志直接写到控制台的两处——终端里画出的登录二维码，以及旧版登录 237 分支的 `console.log(proto.toJSON())`（可能包含验证页信息）。这两处不改 SDK 无法拦截；如果控制台输出会被收集，请注意。
  - `endpoint.login.flow` 事件和历史里不含验证链接（`linkOmitted`），Console 用 `login.flow.get` 读取当前链接。
- **设备 JSON** 只存在于当前挑战上：挑战结束即清空；不写 Zhin 的日志，不进事件和 `system.receive`。辅助脚本是固定文本，只在 `accounts.qq.com/login/attack` 上运行，只设置 `window.__INITIAL_STATE__.deviceInfo`，从不自动提交，也不含任何设备数据。
- **错误码**：`system.login.error` 按一张表映射到 `code_invalid`（验证码 / ticket 错误，留在原挑战重试）、`rate_limited`、`challenge_expired`、`risk_blocked`（冻结、设备被拉黑等）、`credential_invalid`（密码错误）、`network`、`unknown`。平台原文只作为清洗后的说明显示（单行，不含本机路径）。
- **自动重新登录**：有人正在答挑战时不会自动重新登录。验证失败、挑战过期等需要人处理的情况，流程停在「失败 / 已过期」，等你点「重新登录」或发 `icqq login retry`。只有不需要验证的失败（被踢下线、网络或服务器错误、没有出现任何挑战的普通登录失败）才按退避自动重试（5 秒起，最多 8 次），每次重试都记在时间线上；8 次都失败后流程标记为失败（`next: relogin`），并发送不再自动重试的掉线通知。
- **NT 滑块答错**：NT 验证码提交一次就作废，适配器会重新登录拿一个新滑块（失败则流程失败，等你重新登录）；旧版滑块留在原挑战重试。
- **token 不兼容**（错误码 123456）：重新登录读到的还是同一个 token 文件，所以提示删除数据目录里的 `<QQ号>_*_token` 后再登录，而不是建议重新登录。
- Console「刷新二维码」在扫码挑战上直接换一张新二维码；其他挑战不能单独刷新，会改为重新登录。

## 滑块验证助手页

ICQQ 登录要求滑块验证时，Console「登录待办」可以用弹窗打开验证助手页 `https://zhin.js.org/login-assist/tcaptcha.html`：你在弹窗里完成滑块，结果自动回填到待办，不必再打开浏览器开发者工具、从 `cap_union_new_verify` 响应里抄 ticket。

- **它做什么**：在本页加载腾讯验证码脚本（`https://ssl.captcha.qq.com/template/TCapIframeApi.js` 加滑块链接的查询参数，和腾讯自己的验证页发出的请求一致），由你本人完成验证；通过后用 `postMessage` 把 `{ type: 'zhin.login-assist.captcha', nonce, ticket, randstr }` 交回打开它的 Console 窗口（目标源固定为 Console 的源，从不用 `*`），约 1.5 秒后自动关闭。
- **它不做什么**：不替你过验证码；不保存、不上报任何数据（无统计、无存储，除腾讯验证码外不发其他请求）。参数只放在 URL 的 `#` 片段里，不会进入任何服务器日志，并在加载腾讯脚本前从地址栏移除。
- **为什么是独立的域名**：Console 把登录凭据存在自己源的 localStorage，第三方脚本不能在 Console 的源里运行；而腾讯脚本必须在页面自己的源里执行（放进沙箱 iframe 会一直停在「安全检测中」）。所以助手页放在 `zhin.js.org`，不放在 Console 里。
- **在别的设备上打开**（例如把链接发到手机）：没有可回传的 Console 窗口，页面会显示 `ticket,randstr` 文本和「复制」按钮，把它粘贴到 Console 登录待办的滑块输入框提交即可。
- **验证没通过或被关闭**：页面显示「验证未完成」，点「重试」重新加载验证码。

链接格式：`#` 后是 base64url 编码的 JSON `{ q, n, o }`。`q` 是滑块链接的查询串（以 `?` 开头，参数名在白名单内，值必须已 URL 编码，总长不超过 4096）；`n` 是 Console 生成的一次性标识（1–128 个 `A-Z a-z 0-9 . _ ~ -` 字符）；`o` 是 Console 的源（如 `https://console.example.com`，只允许 http/https，不能带路径）。不合格的链接会被拒绝，并且不会加载腾讯脚本。

**自建**：不想依赖 `zhin.js.org` 时，把 [`docs/public/login-assist/tcaptcha.html`](https://github.com/zhinjs/zhin/blob/main/docs/public/login-assist/tcaptcha.html) 复制到你自己的 https 域名（单文件，不依赖其他资源；该域名没有 `/logo.svg` 时 logo 自动隐藏），再把 `console.loginAssist.captchaHelperUrl` 设为它的地址：

```yaml
console:
  loginAssist:
    captchaHelperUrl: https://captcha.example.com/tcaptcha.html
```

不要把它放在 Console 的同一个源下。页面自带严格的 CSP（内联脚本按 sha256 放行）；如果改动了内联脚本，要同步更新 CSP 里的哈希（`pnpm vitest run tests/docs/login-assist-captcha-page.test.ts` 会给出新值）。托管方不能改写 HTML（压缩、注入脚本会让哈希失效），并且应当用响应头禁止嵌入：参考仓库里 `docs/public/_headers` 的 `/login-assist/*` 规则（`Cache-Control: no-transform`、`Content-Security-Policy: frame-ancestors 'none'`、`Referrer-Policy: no-referrer`）。

## 掉线通知与重新登录

配置 `notify` 后，ICQQ 被踢下线、登录失败或启动失败时，会通过另一个适配器实例给 master 发通知。例如用 QQ 官方机器人实例通知：

```yaml
qq:
  # ... 已配置好的 QQ 官方机器人
icqq:
  master: 123456
  autoReconnect: true   # 默认 true：被踢下线后自动重新登录
  notify:
    adapter: qq
    endpoint: bot-1
    kind: private
    id: "${QQ_MASTER_OPENID}"   # master 在 QQ 官方机器人里的 openid
```

`autoReconnect: true` 时，被踢下线会自动重试登录；出现二维码、滑块、设备锁或身份验证时，通知会提示下一步。收到通知后可以直接在 QQ 里完成：

| 命令 | 作用 |
|------|------|
| `icqq login qr` | 把 ICQQ 登录二维码发到当前会话（QQ 支持图片时） |
| `icqq login confirm` | 扫码、设备锁或身份验证完成后继续登录 |
| `icqq login code [QQ号] <内容>` | 提交滑块 ticket（可粘贴整段响应）或 6 位短信验证码；设备锁回复 `sms` 改用短信，短信挑战回复 `resend` 重新发送 |
| `icqq login status` | 查看在线状态、当前挑战的步骤和链接、上次失败原因 |
| `icqq login retry` | 重新登录（新的登录流程） |

**设备锁**：`icqq login status` 会给出验证链接。用手机 QQ 完成验证后回复 `icqq login confirm`；无法用链接验证时回复 `icqq login code sms`，收到短信后回复 `icqq login code <验证码>`。不回复 `sms` 不会发短信。身份验证需要复制设备信息，请在 Console 完成。等待验证期间不会自动重新登录（否则链接会失效）；5 分钟没有处理，挑战过期，等你重新登录。

命令只接受 master（顶层或 `endpoints[i].master`）或 `notify.id` 对应账号；两者都没配置时请用 Console 的 ICQQ 页面。没有配置 `notify` 时，掉线只写日志并在 Console 显示登录待办。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 一直停在登录中 | 打开 Console 登录待办，完成二维码、滑块、设备锁或身份验证；流程停在「失败 / 已过期」时点「重新登录」 |
| 签名失败 | 检查 `signApiAddr`；本地模式确认 `@icqqjs/qqsign` 已安装且版本匹配 |
| 重启后重复登录 | 持久化设备与会话数据目录，避免每次生成新设备 |
| 请求或通知未显示 | 在账号页「聊天」页签检查好友申请与邀请、通知；ICQQ 优先读取平台请求列表 |

## License

MIT

### 发送回执与未知结果

发送成功回执只接受平台真实消息 ID。网络超时、断线、缺少消息 ID 的响应会报告 `deliveryUnknown`，框架不会自动重发；手动重发可能重复发送。

ICQQ 原生分享和文件 API 可能已经成功，但只返回空值或文件 ID；这类结果不能当作可引用、可撤回的消息 ID。适配器不会根据时间和卡片类型从历史猜测本次分享的 ID；同一时刻的其他卡片也可能匹配。没有直接消息 ID 的部分保留为未知，平台操作仍只执行一次。文件撤回应使用平台专用文件 API。

### 独立元素按顺序拆分发送

ICQQ 要求分享、文件、语音、视频、JSON 卡片和合并转发单独成条。一条消息里同时有文字和这些元素时（例如 Agent 回复“找到了：”加一张音乐分享卡片），适配器按原顺序拆成多条依次发送，引用只附在第一条普通消息上。

- 回执按发送顺序保留每部分的真实 ID 和原始段位置；没有 ID 的卡片或文件保留未知槽位，不把完整回复正文复制给每个 ID。所有部分都没有 ID（如单独一张分享）时，仍报告投递结果未知。
- 第一条就失败时原样报告失败；后面的部分失败时报告 `partial_delivery`（结果未知），保留已完成部分的回执。前面的调用可能已被平台接收，重发可能重复。

## 语言

Endpoint 管理和工具反馈跟随当前操作语言；登录没有当前聊天发送者，LoginAssist 提示采用项目语言。提示文案变化不改变扫码、短信、滑块验证过程，群管理权限、审批与平台结果检查保持原规则。

Endpoint 添加用法中的调用头由当前环境的实际命令前缀与插件命名空间提供；未知时只提示所需参数，不生成猜测命令。

## 当前账号资料

`endpointSpec.profile` 接到原生 ICQQ Client 的资料卡与设置方法；Agent 通过统一的 `get_self_profile` / `set_self_profile` 工具访问当前账号，修改沿用身份类审批。平台资料优先于配置兜底，群名片仍是独立的场景资料。

- 可读：昵称、性别、年龄、个性签名、头像 URL。只投影这些公开资料，不把 SDK 返回的邮箱、QID 等一起交给模型。
- 可写：昵称、性别、签名、个人说明、头像。SDK 返回 `false` 时明确拒绝，不报告成功。头像输入经工具链解析为已授权图片，结果不回传图片 base64。
- 年龄不反推生日；当前安装的 ICQQ 1.12.3 `setBirthday` 月日编码有缺陷，因此不开放生日写入。兴趣无对应已验证接口，只能使用配置兜底。

配置的 `nickname`、`profile` 可放在适配器默认值或某个 `endpoints[]` 项中；Endpoint 逐字段覆盖默认值，只有平台未提供的字段才使用它们。配置兜底不会写回 QQ。

## 成员身份

群消息的 `sender.role`（`owner` / `admin` / `member`）归一为 `sender.platform.standing`；私聊不上报。QQ 群没有原生角色与权限位，`roles` / `permissions` 不上报。能力画像：`group.scene.platformStanding = { standing: true }`。详见 [ADR 0056 §1](https://github.com/zhinjs/zhin/blob/main/docs/adr/0056-chat-roles.md)。
