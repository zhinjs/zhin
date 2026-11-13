---
sidebar: false
---

# ADR 0058：登录辅助 v2——每个账号一条登录流程，挑战带引导材料，提交后能看到真实结果

状态：Accepted（2026-11-13），P1 已实施

关联：ADR 0044（适配器能力画像）、ADR 0049（Console 访问控制与审计）、ADR 0054（管理网关与实例）、ADR 0057（配置与状态存放）。

## 背景

LoginAssist（`packages/im/core/src/built/login-assist.ts`）是适配器在扫码、短信、滑块、设备锁时向人求助的通道。盘点（2026-11-13）发现这些问题：

1. **只有一次性待办**：`waitForInput` 发出一条待办，提交后立即删除。提交以后到底成功、验证码错误还是要换新二维码，Console 和终端都不知道。
2. **取消和完成分不清**：`submit`、`cancel`、`cancelOwned` 都发 `endpoint.login.resolved`。
3. **事件类型对不上**：`login-assist-binding.ts` 只转发 pending / expired，协议（`@zhin.js/console-protocol`）把它们标成 `ConsoleEndpointEventData`，和实际的 `PendingLoginTask` 不符。
4. **终端是 FIFO**：任意一行输入都喂给队首待办；`qrcode` / `auth` 回车即提交 `ok`；提交后什么都不打印。两个账号同时登录时输入会送错。
5. **没有重新登录**：Console 只有 `login.list` / `submit` / `cancel`，`submit` 只回 `{ success: true }`。
6. **账号行的 `pendingLogin` 从未填写**：`ConsoleEndpointSummary.pendingLogin` 存在，`endpoint-runtime.ts` 从不赋值。
7. **引导写死在 SDK 里**：滑块的「按 F12 找 ticket」说明写在 icqq SDK 中，身份验证没有任何引导，用户需要自己去找设备信息和验证页。

onebots 的登录辅助（分步说明、复制设备信息、辅助脚本）证明了引导材料的价值，本 ADR 只把它当思路来源，不复用其代码。

## 决策

### 1. 模型：LoginFlow

每个 Endpoint 同时只有一条登录流程，流程里同时只有一个待答的挑战。

| 对象 | 字段 |
|---|---|
| LoginFlow | `id`、`adapter`、`endpointKey`、`endpointIdentity`、`startedAt`、`attempt`、`state`（`active` / `online` / `failed` / `cancelled` / `expired`）、`currentStep`、`steps`（有序，最多 20 条）、`lastOutcome`、`revision`、`pendingConfirmation`、`activeTaskId` |
| LoginStep | `id`、`kind`（`connect` / `challenge` / `verifying` / `info`）、`status`（`active` / `done` / `failed` / `skipped`）、`title` / `titleKey`、`at`、`challenge?`、`outcome?` |
| LoginOutcome | `result`（`accepted` / `rejected` / `expired` / `needs_new_challenge` / `online` / `failed`）、`code?`、`message?`（单行、已清洗）、`next?`（`retry_input` / `refresh_challenge` / `relogin` / `wait` / `none`）、`retryAfterMs?` |

规则：

- 新挑战把上一个挑战标为 `skipped`（被替换），并以 `LoginChallengeReplacedError` 结束它的 Promise，不再静默取消。
- 提交后自动插入一条 `verifying` 步骤。20 秒（`verifyTimeoutMs` 可配）内没有结果，流程标记 `pendingConfirmation`（「结果待确认」），**不算失败**。
- 挑战过期：步骤 `failed`，结果 `expired / challenge_expired`，流程进入 `expired`；适配器再开新挑战即恢复 `active`。
- `online`、`failed`、`cancelled` 是终态；之后对该流程句柄的调用被忽略。
- 同一 Endpoint 实例再次 `beginFlow` 时，旧流程以 `superseded` 取消；`attempt` 在上次不是 `online` 时递增。
- 换代时旧实例（另一个 owner）未结束的流程保留到它自己取消，列表只展示每个账号最新的一条。

### 2. 挑战描述符

适配器负责文案和多语言，core 只做清洗。

| 字段 | 说明 |
|---|---|
| `kind` | `qrcode` / `link_verify` / `slider` / `sms` / `device` / `auth` / `confirm` / `other`，只决定图标和排序 |
| `title`、`help` | `help.short`、`help.steps`（有序；每项可为字符串或 `{ text, blockId?, doneWhen?: 'copied' \| 'opened' \| 'manual' }`）、`help.warning` |
| `blocks` | 引导材料，见第 3 节 |
| `media` | `qrImage`、`link {url,label}`、`expiresAt`、`refreshable`、`captcha` |
| `input` | `kind`（`none` / `code` / `ticket` / `text`）、`label`、`pattern`、`patternHint`、`length`、`secret`、`extract: 'ticket-json-or-url'` |
| `actions` | `{ id, label, variant: 'primary' \| 'secondary' \| 'danger', requiresInput?, cooldownMs? }[]`；省略时有输入给「提交」，无输入给「已完成」 |

链接只保留 http / https。标题、说明、结果文本都会去掉控制字符、截断，并把本流程提交过的值替换成 `***`。

### 3. 验证引导与辅助材料

挑战可以一步步带人完成验证，并把需要的材料直接交给他。`blocks` 按顺序渲染在说明和输入框之间：

| 块 | 字段 | Console 表现 |
|---|---|---|
| `copy` | `id`、`label`、`content`、`format`（`json` / `script` / `text`）、`sensitive?`、`collapsed?`、`collapsedLabel?`、`bookmarklet?`、`thenOpen?` | 等宽、复制按钮、可折叠；`sensitive` 默认隐藏，点「显示」才出现；`thenOpen` 指向一个 link 块时合并成「复制并打开验证页」一个按钮；`script` 可带 `bookmarklet`，提供「拖到书签栏」链接，开发者工具 Console 作为后备 |
| `link` | `id?`、`label`、`url`、`showQr?` | 只允许 http / https；`showQr` 时在浏览器本地把链接画成二维码，方便用要验证的那台手机扫 |
| `note` | `text`、`tone?`（`info` / `warning`） | 提示行 |

`help.steps` 的 `blockId` + `doneWhen` 让界面在用户复制、打开后自动勾掉这一步，并显示当前在第几步。

安全规则：

- `sensitive` 的复制块（设备信息、令牌）只存在于**活动挑战**上。挑战结束、过期或被替换时内容清空并标 `redacted: true`；事件与历史（`endpoint.login.flow`）里始终是清空后的版本，实时内容只能用 `login.flow.get` 读。日志和审计从不包含它。
- 终端只在用户选择「显示 xxx」这个编号操作时才打印敏感块。
- 脚本块是适配器提供的**静态文本**，不得把用户或设备数据拼进脚本；需要的数据由用户在脚本的 `prompt()` 里粘贴。书签小程序由同一段静态文本生成。

`extract: 'ticket-json-or-url'` 由 core 的纯函数 `parseLoginTicket()` 实现，Console、SDK 和终端共用。它接受：裸 ticket、`ticket,randstr`、验证接口返回的 JSON（`{ticket, randstr}`，也看 `data` / `result` 下一层）、带 `ticket=` 的链接（查询串或片段）。返回 `{ ticket, randstr? }`，失败时给出精确原因（「JSON 中没有 ticket 字段」「链接中没有 ticket 参数」等）。

#### 托管验证码辅助页

滑块挑战可以带 `media.captcha: { provider: 'tencent', query, helperUrl? }`，`query` 是平台滑块链接的查询串原文。

1. Console 打开 `${helperUrl ?? 默认}#${payload}` 弹窗。`payload` 是 base64url 编码的 JSON `{ q, n, o }`：查询串、随机 nonce、Console 自己的 origin。放在片段里，不进任何服务器日志。
2. 辅助页（`docs/public/login-assist/tcaptcha.html`，默认地址 `https://zhin.js.org/login-assist/tcaptcha.html`）用该查询串加载腾讯验证码，成功后向 `window.opener` 的 `o` 发送 `{ type: 'zhin.login-assist.captcha', nonce, ticket, randstr }`。
3. Console 校验 `event.origin === new URL(helperUrl).origin` 和 nonce，然后提交 `{ action: 'submit', values: { ticket: 'ticket,randstr' } }`。

共享部分在 core 的纯模块 `login-captcha.ts`：`LOGIN_CAPTCHA_MESSAGE_TYPE`、`DEFAULT_CAPTCHA_HELPER_URL`、`buildCaptchaHelperUrl()`、`parseCaptchaHelperPayload()`、`parseCaptchaHelperMessage()`。部署方可在 `console.loginAssist.captchaHelperUrl` 换成自己的页面（https，或本机 http）。

为什么要独立的源：

- Console 的登录令牌存在 `localStorage`，第三方验证码脚本不能和它同源运行。
- 腾讯的加载器必须在页面自己的源里执行；已验证放进不透明源的 sandbox iframe 会停在「Safety check」。

真实账号的端到端测试尚未完成，P2 接入 icqq 时补上。

#### icqq 示例（P2 实施）

- **身份验证（`auth`）**：步骤为
  1. 复制设备 JSON；
  2. 打开验证链接，进入发送验证码页；
  3. 在该页开发者工具 Console 运行辅助脚本，并粘贴 JSON；
  4. 完成验证后点「已完成，继续登录」。

  材料：一个 `sensitive` 的 JSON 复制块（设备信息，`thenOpen` 指向验证链接）、一个折叠的脚本块（可做书签）、`showQr` 的验证链接、`help.warning`「请勿把设备 JSON 粘贴到其他网站或发给他人」。脚本由我们自己编写：只在 `accounts.qq.com/login/attack` 上运行，用 `prompt()` 读入 JSON 并设置 `window.__INITIAL_STATE__.deviceInfo`，从不自动提交。
- **滑块（`slider`）**：把 SDK 里写死的 F12 说明移到适配器的 `help.steps`；输入带 `extract: 'ticket-json-or-url'`；同时带 `media.captcha`，常见路径用托管辅助页，不需要开发者工具。

### 4. 体验目标

- 常见路径不需要开发者工具；
- 每一步都显示当前在哪一步，并随复制、打开自动前进；
- 滑块输入框粘贴什么都能识别（ticket、JSON、链接）；
- 需要手机验证的链接可以直接扫码；
- 敏感数据默认隐藏。

### 5. 同步反馈与错误码

Console 新版提交时带 `wait: true`：主机最多等 15 秒，回 `{ accepted: true, outcome, flow }`；等不到回 `{ accepted: true, pending: true }`。不带 `wait` 时回复仍是 `{ success: true }`。

结构化答案不符合挑战（未知操作、缺输入、格式不对）时，`submit` 抛 `LoginSubmissionError`，挑战保持打开，RPC 回 `{ error, data: { code } }`，错误信息不含提交的值。

| 错误码 | 默认 `next` | 含义 |
|---|---|---|
| `code_invalid` | `retry_input` | 验证码 / ticket 错误 |
| `rate_limited` | `wait` | 操作太频繁 |
| `challenge_expired` | `refresh_challenge` | 挑战过期 |
| `risk_blocked` | `none` | 平台风控拒绝 |
| `credential_invalid` | `relogin` | 密码 / 令牌无效 |
| `network` | `wait` | 网络错误 |
| `unknown` | `relogin` | 其它 |

### 6. 重新登录策略

- 有活动挑战时，适配器的**自动**重新登录要暂停：`assist.hasActiveChallenge(endpointKey, adapter?)` 为真就不重连，避免把人正在答的挑战冲掉。
- 人在 Console 点「重新登录」或「刷新二维码」是明确操作，照常执行。
- 这两个操作经 Endpoint 的登录端口（`createEndpointSpecification(client, { login: { relogin, refreshChallenge } })`），由 AdapterIndex 按租约包装，调用时带账号实例的信号。

### 7. 能力声明

`defineAdapter({ login: { mode, challenges?, relogin?, refreshQr? } })`，不写就是不支持。

- `mode`：`interactive`（有人答挑战）、`credential`（配置凭据；挑战只能是凭据录入）、`external`（在别的程序里登录，Zhin 只连接）。
- `login.relogin` / `login.refresh` 只有在声明为 `true` **且** Endpoint 实现了对应钩子时才执行，否则回 `unsupported: …`，`data.code = 'unsupported'`。
- 账号行（`ConsoleEndpointSummary`）带上 `login` 声明、`pendingLogin` 和 `loginStep { index, total, title }`。

### 8. 权限、审计与安全

| RPC | 权限 |
|---|---|
| `login.list`、`login.flow.list`、`login.flow.get` | `endpoint.view` |
| `login.submit`、`login.cancel`、`login.relogin`、`login.refresh` | `endpoint.operate` |

- 请求带 `adapter` + `endpointKey` 时按账号授权，账号范围的操作员也能处理自己的账号；主机校验任务确实属于这个账号，否则当作找不到。
- 新事件 `endpoint.login.flow` 和其它 Console 事件一样走 `/api/events`（`status.view`）；事件里没有二维码图片（`qrImageOmitted: true`）和敏感块。它不是独立的 WebSocket，所以 `CONSOLE_WS_PERMISSIONS` 不变。
- 写操作照常进审计：操作者、`rpc:login.*`、目标账号（请求带账号时）、成败，再加结果类别（`accepted` / `rejected` / `pending` / `unsupported` 与错误码）。从不记录值和结果文本。
- 快照、事件、日志、终端时间线都不含提交的值；二维码只挂在活动挑战上，结束即删除。

### 9. 适配器映射

| 适配器 | 方式 | 说明 |
|---|---|---|
| icqq | interactive | 二维码、滑块、设备锁、身份验证；`relogin`、`refreshQr`（P2） |
| bilibili | interactive | 把现有扫码状态机 `idle / waiting / scanned / confirmed / expired / failed` 桥接为流程步骤 |
| weixin-ilink | interactive | 扫码登录，新增 `need_verifycode` 和 `verify_code_blocked`（映射 `rate_limited` / `risk_blocked`） |
| qq（官方机器人）绑定 | credential | 凭据录入，复用挑战卡片（输入框 + 提交） |
| napcat、onebot11/12、milky、satori | external | 只显示连接状态和外部登录提示 |
| telegram、discord、slack、lark 等令牌类 | credential | 令牌错误报 `credential_invalid` |

### 10. 旧 API 映射

`waitForInput` 继续可用：在隐式流程里开一个挑战，旧 payload 映射为描述符（`qrcode` / `auth` → 「已完成」操作；`slider` → ticket 输入；其它 → 文本输入 + 提交）。旧格式字符串提交时原样交给旧调用方；新格式 `{ action, values }` 提交给旧任务时，旧调用方收到 `values.input`，没有输入时收到 `ok`。

`cancelOwned(owner, reason)` 的原因映射到流程：`replaced_by_*` 只替换挑战，`online` 记为上线，`login_error` 记为失败，其余结束流程。

## 兼容

| 组合 | 行为 |
|---|---|
| 旧 Console ↔ 新主机 | `login.list` / `submit` / `cancel` 和 pending / expired 事件不变；不带 `wait` 的回复不变 |
| 新 Console ↔ 旧主机 | 先调 `login.flow.list`；得到 403（未登记的 RPC 对所有人拒绝）或 `Unknown RPC type` 时退回 `login.list` 轮询，不显示重新登录 |
| 旧适配器（只用 `waitForInput`） | 自动得到隐式流程和时间线；没有结果上报时提交 20 秒后显示「结果待确认」 |

## 分期

| 期 | 内容 |
|---|---|
| P1 | 本 ADR 的模型、描述符、引导块、托管验证码辅助页的共享函数、协议与权限、主机 RPC、审计、终端、账号行字段、配置 `console.loginAssist.captchaHelperUrl` |
| P2 | icqq 改用 `beginFlow`：错误码映射、身份验证与滑块引导、`relogin` / `refreshQr`、自动重连让位于活动挑战、真实账号测试 |
| P3 | bilibili、weixin-ilink 接入 |
| P4 | 新 Console 登录卡片：时间线、复制并打开、扫码链接、书签小程序、托管辅助页弹窗、`wait: true` |
| P5 | credential / external 适配器补齐声明与提示，qq 绑定复用卡片 |

## 后果

- 适配器作者多了一套 API，但旧 API 不用改也能得到时间线。
- 主机多了四个 RPC，都已登记权限。
- 引导文案由适配器维护，core 不认识任何平台名。
