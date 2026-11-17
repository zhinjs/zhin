---
sidebar: false
---

# ADR 0064：Sandbox 全能力渲染与「按平台预览」——降级只在声明里发生，并且说得出原因

状态：已接受（Accepted，2026-11-16）。所有者 2026-11-16 的决定：「按推荐的来，先做 P0 和 P1」——文末「决定」表中的 D1–D11 全部按推荐执行，实施顺序先 P0、P1。实施进度：P0（F1、F2）已实施，其余阶段未开始。2026-11-17 增补「入站能力对齐」（D12–D17、阶段 I0–I4，见文末），所有者授权按推荐处理，已接受；其中 I0 已实施。以下为提议时的说明，保留作记录：提议（Proposed，2026-11-16）。依据：zhinjs/zhin#1250 评论 6909604726 的 `sandbox-capability-parity`；同一评论中的 `select-over-10-options-no-buttons` 与本 ADR 的 §3 合并处理。核对基线：`origin/sync/feat-main-1116`。

关联：[ADR 0044](./0044-adapter-capability-profile.md)（适配器能力画像；核心只认能力、不认平台名；`check:no-platform-branches`）、[ADR 0061](./0061-inbound-message-outcomes.md)（每条入站消息都有结局与原因——本 ADR 是它在出站侧的对应：每次降级都有原因）、[ADR 0063](./0063-console-plugin-ui-unification.md)（Sandbox 页面用 `@zhin.js/console-ui`，新增控件遵守其设计规则）、[ADR 0049](./0049-console-rbac.md)（Console 权限映射）。

## 背景

主人的要求（原话摘要）：Sandbox 是开发者和群主看「zhin 能做出什么效果」的地方。按钮、选择列表、指令菜单、Markdown、卡片这些各平台支持程度不同的能力，**在 Sandbox 里应该全部支持、全部按最好的效果渲染**；在此基础上再加一个「按平台预览」开关，切到某个平台时按该平台的能力降级显示，并在消息旁标注「icqq 不支持按钮，这里退化成了序号列表」。

### 1. 出站链路里，降级发生在哪里

出站段的降级全部在 core 的投影函数里，由适配器声明驱动（ADR 0044 §5「出站」）：

| 步骤 | 函数（`packages/im/core/src/plugin-runtime/im/`） | 读的声明 | 降级结果 |
|---|---|---|---|
| Markdown | `outbound-segments.ts` `resolveOutboundMarkdownPolicy` / `applyOutboundMarkdownPolicy` | `segments.markdown`，缺省 `text` | `markdown` → 纯文本 `text` |
| HTML | `resolveOutboundHtmlPolicy` + `normalizeOutboundPayload` → `renderHtmlSegment` | `segments.html`，缺省 `image` | `direct` 原样；`image` 由 html-renderer 以 `DEFAULT_CARD_WIDTH = 540` 渲染成 PNG；无渲染器 / 仅 URL 媒体 → 文本 |
| 媒体 | `resolveOutboundMediaPolicy` / `applyOutboundMediaPolicy` | `segments.outboundMedia`，缺省 `['url']` | 非 URL 媒体 → 文本（alt / 文件名） |
| 交互 | `resolveOutboundInteractivePolicy` / `applyOutboundInteractivePolicy` | `segments.interactive`，缺省 `text` | `keyboard` → 序号文本（`renderKeyboardAsText`），并登记回数字的映射 |
| 白名单 | `resolveOutboundSupportedSegments` | `segments.supported` | 不在列表的段 → 整条消息 `unsupported_operation`，不发送 |

上述步骤由 `outbound-renderer.ts` 的 `projectOutboundPayload` 串起来，结果带 `rendering.fallbacks`（`OutboundFallbackReason`，见 `message-events.ts:76`：`renderer_unavailable | renderer_failed | media_unsupported | html_text_policy | markdown_text_policy | interactive_text_policy`）。这是**消息级**的原因集合，没有「哪一段、从什么变成了什么」，而且目前没有送到 Sandbox 页面。

Sandbox 适配器的声明（`plugins/adapters/sandbox/adapters/sandbox/index.ts`）：`html: 'direct'`、`markdown: 'native'`、`outboundMedia: ['url','base64','path']`、`interactive: 'native'`，不声明 `supported`（全部透传）。流式由端点 `createEndpointSpecification({ streaming: { mode: 'native' } })` 提供（`src/endpoint.ts:205`，`streaming` 配置缺省开启），只承载 `text` / `markdown`。所以**在 core 这一侧，Sandbox 今天已经基本不走降级路径**；差距主要在三处：core 在适配器之前就替所有平台做的决定、Sandbox 页面的渲染器、以及画像里没有的能力。

### 2. 现状差距（逐项核实）

| # | 能力 / 段 | 现状 | 原因（文件） |
|---|---|---|---|
| G1 | `select` 超过 10 项 | 渲染成纯文本序号列表，没有按钮，却提示「可以点击按钮」 | `packages/im/core/src/built/user-interaction.ts:219` `actionsFor` 只在 `options.length <= 10` 时生成按钮；`instructionFor`（`:225`）固定返回 `interaction-messages.ts:24` 的 `selection` 文案。10 是 QQ 键盘上限，被写死在 core 里，对所有平台生效，Sandbox 也被连累 |
| G2 | `multiselect` | 任何平台都没有按钮，只有「回复序号，用逗号分隔」 | `actionsFor` 不处理 `multiselect`；canonical 段里也没有「选择器」这种语义段，只能表达成 `markdown` + `keyboard` |
| G3 | `select` / `multiselect` 作为语义 | 不存在 | `segment-contract/assert.ts` 的 `CORE_EXTENSION_TYPES` 没有选择器段；适配器无从声明「我原生支持下拉 / 多选」（Discord、Telegram、Lark 其实有） |
| G4 | HTML 卡片的设计宽度 | 段里没写 `width` 时，Sandbox 按聊天栏宽度（常见约 300px）排版；平台侧则按 540px 渲染成图 | `pages/index/HtmlMessage.tsx` 只有 `data.width` 存在时才按宽度排版再缩放；540 是 `outbound-segments.ts` 里的私有常量 `DEFAULT_CARD_WIDTH`，页面拿不到。#1250 的 `sandbox-html-card-300px` 只修了带 `width` 的指令菜单 |
| G5 | 「完整 Markdown」 | 支持标题、引用、列表、任务列表、代码块、表格、分隔线、粗斜删、行内代码、链接；**不支持**行内图片 `![]()`、嵌套行内格式（链接里的粗体等）、嵌套列表 | Sandbox 用 `packages/console/client/client/message-content/markdown.ts` 的自写解析器，`INLINE_PATTERN` 只认上述几种 |
| G6 | `file` / `link` / `qrcode` / `tts` 段 | 落入 `default` 分支，显示回退文本或 `[file]` | `pages/index/SandboxChat.tsx` 的 `renderMessageSegments` switch 只有 text / markdown / html / code / mention / face / dice / rps / image / video / audio / record / reply / forward / card / share / button / keyboard |
| G7 | 音乐卡片 | 封面、歌名、歌手、链接都显示（主人认可），但 `share.data.audio` 不播放 | `SandboxChat.tsx` `case 'share'` 只读 `url / title / description / image` |
| G8 | 流式 | 已实现，但**不在能力画像里** | 流式只在端点 spec 上；`AdapterCapabilityProfile`（`packages/im/adapter/src/capability-profile.ts`）没有 `streaming` 字段，静态画像无法回答「某平台能不能流式」，预览也就无从降级 |
| G9 | 非段能力：引用、撤回、编辑、表情回应、@全体 | Sandbox 画像都没声明，Agent 认为 Sandbox 不能做这些 | `adapters/sandbox/index.ts` 的 `messaging` 只有 `segments` |
| G10 | 回归守卫 | 没有「每种段都有最好效果渲染器」的测试；新加一种段时，Sandbox 会悄悄落到 `default` | 只有零散测试（`tests/html-message.test.ts`、`sandbox-core-interaction.test.ts`、`sandbox-core-streaming.test.ts`）；页面的回退函数 `pages/index/segmentFallback.ts` 本身就是「静默降级」 |

### 3. 顺带发现的画像问题（预览上线后会立刻暴露）

| # | 问题 | 位置 |
|---|---|---|
| F1 | **按会话类型声明的 `segments` 不生效**。`resolveOutbound*` 全部读 `definition.segments`，而 `defineAdapter` 只把 `profile.default.messaging.segments` 镜像到这里（`packages/im/adapter/src/definition.ts:208-216`）。QQ 官方在 `channel` 下整段覆盖了 `segments`、去掉 `card` / `share`（`plugins/adapters/qq/adapters/qq/index.ts:64-72`），但实际发送仍按 `default` 判断 | `outbound-segments.ts` 全部 `resolve*` |
| F2 | **GitHub 没有声明 `markdown: 'native'`**，所以 `markdown` 段在发往 Issue / PR 评论前被 `markdownToPlainText` 去掉格式，而 GitHub 评论本身就是 Markdown；`html` 缺省 `image`、媒体只有 `url` → HTML 变纯文本 | `plugins/adapters/github/adapters/github/index.ts:16-26`、`src/protocol.ts` `formatOutboundBody` |
| F3 | 端点编解码器里的隐性降级不在画像里：QQ 的按钮必须和 Markdown 在同一条物理消息（`plugins/adapters/qq/src/outbound.ts:400`）、QQ 图文卡片字段不全不发（模型 hint 里写了，画像没写）、按钮数 / 行数上限 | 各适配器 `src/outbound.ts` |

F1、F2 不改，预览就会如实显示错误的结果（例如「GitHub 不支持 Markdown」）。这其实是预览的价值，但应当先修声明，避免主人第一次打开预览就看到误导性的标注。

## 决策

### 0. 原则

1. **Sandbox 是能力的上界**：Sandbox 声明画像里每一项出站能力的最高档，页面对每一种出站段都有专用渲染器；Sandbox 不走任何降级路径。这是约定，由测试守住（§6）。
2. **降级只发生在 core 的投影函数里，并且产出报告**：同一组纯函数既用于真实发送，也用于预览；预览不另写一套「模拟 icqq」的逻辑。
3. **预览读真实适配器的声明**：开关里的每个选项对应一个适配器的静态画像（按会话类型解析后），不是 Sandbox 里手写的平台表。Sandbox 的运行时代码里不出现平台名分支（ADR 0044 §0.1），`check:no-platform-branches` 的扫描范围扩到 Sandbox。
4. **标注来自报告，不来自猜测**：「icqq 不支持按钮，这里退化成了序号列表」由报告条目 + 平台显示名 + 固定模板生成。画像没声明、只发生在端点编解码器里的降级（F3），预览不假装知道，统一注明「仅按能力画像预览」。

### 1. 出站段目录：一处定义，测试与渲染器都对照它

在 `packages/im/core/src/built/segment-contract/` 新增 `catalog.ts`，导出 `OUTBOUND_SEGMENT_CATALOG`：每种可出站段的类型名、所属能力（`messaging.segments.*` 的哪一项）、一个最小合法示例（供测试用）。内容 = `STRICT_CANONICAL_TYPES` ∪ `CORE_EXTENSION_TYPES` − 仅入站的 `action`，再加上 §3 新增的 `select`。`assert.ts`、`delivery.ts` 的 `IM_VISIBLE_TYPES` 改为从目录派生，避免三处名单漂移。

### 2. Sandbox 声明全部能力（契约）

`plugins/adapters/sandbox/adapters/sandbox/index.ts` 的画像改为：

```ts
messaging: {
  segments: {
    html: 'direct',
    markdown: 'native',
    outboundMedia: ['url', 'base64', 'path'],
    interactive: { buttons: 'native', select: 'native', multiselect: 'native' }, // §3
  },
  streaming: { mode: 'native', formats: ['text', 'markdown'] },              // §5，新字段
  mention: { user: true, all: true },
  quote: true,
  // recall / edit / reaction：见「决定」D9，实现端点操作后再声明（声明了未实现会在装配期报错）
},
```

同时补齐页面渲染器（`pages/index/SandboxChat.tsx` 的 switch 拆到 `pages/index/segments/<type>.tsx`，并导出 `SANDBOX_SEGMENT_RENDERERS: Record<OutboundSegmentType, Renderer>`）：

| 段 | 最好效果 |
|---|---|
| `html` | 始终按设计宽度排版再等比缩放；无 `data.width` 时用 core 导出的 `DEFAULT_CARD_WIDTH`（540，从 `outbound-segments.ts` 提升为公开常量，或在 `normalizeOneSegment` 的 `direct` 分支直接盖章 `width`，见 D5） |
| `markdown` / `text` | 解析器补行内图片、嵌套行内格式、嵌套列表（改 `packages/console/client/client/message-content/markdown.ts`，Console 其他消息视图同时受益） |
| `share` | 有 `audio` 时显示播放按钮（`<audio>`，沿用 `resolveMediaSrc` 的来源校验） |
| `file` | 文件卡片：名称、大小（若有）、下载链接 |
| `link` | 链接卡片 / 行内链接 |
| `qrcode` | 本地生成二维码图像（复用 `packages/im/core/src/built/generated-qrcode.ts` 的同一库，页面侧用浏览器版本） |
| `tts` | 文本 + 「朗读」按钮（`speechSynthesis`） |
| `select` / `multiselect` | §3 的原生选择器 |
| `button`（遗留分支） | 删除：JSX `<button>` 已由 `interactive-router.ts` 绑定成 `keyboard` 段 |

`pages/index/segmentFallback.ts` 保留，但只用于历史数据和第三方命名空间段（`foo:bar`），并在开发构建里打印一次告警，便于发现漏掉的渲染器。

### 3. 选择器成为语义段，按适配器能力逐级降级（合并 `select-over-10-options-no-buttons`）

1. 新增 core 扩展段 `select`：

   ```ts
   type SelectSegmentData = {
     mode: 'single' | 'multiple';
     options: { label: string; payload: string; description?: string; aliases?: string[] }[];
     min?: number; max?: number; separator?: string;
     fallback: { hint: string; map: Record<string, string> };   // 与 keyboard 相同的回数字映射
     purpose?: 'approval';
   };
   ```

2. `AdapterSegmentPolicy.interactive` 从 `'native' | 'text'` 扩展为「字符串简写 | 对象」：

   ```ts
   interactive?: 'native' | 'text' | {
     buttons?: 'native' | 'text' | { maxPerRow?: number; maxRows?: number; maxTotal?: number };
     select?: 'native' | 'buttons' | 'text';       // 缺省：buttons 原生则 'buttons'，否则 'text'
     multiselect?: 'native' | 'buttons' | 'text';  // 'buttons' = 每项一个切换按钮 + 提交
   }
   ```

   简写 `'native'` = `{ buttons: 'native', select: 'buttons', multiselect: 'text' }`，`'text'` = 全部 `text`。现有 24 个适配器不改也保持今天的行为。QQ 官方补 `buttons: { maxPerRow: 5, maxRows: 5 }`（具体数值由 QQ 适配器维护者确认），10 这个数字从 core 移到 QQ 的声明里。

3. 新增降级函数 `applyOutboundSelectPolicy(payload, policy, report)`，位于 `outbound-segments.ts`，在交互降级之前执行：`native` 原样；`buttons` 转成 `keyboard`，超过 `maxTotal` 时只给前 N 项加按钮、其余保留在序号列表里（报告 `select_overflow`，并改写提示文案）；`text` 转成序号列表。
4. `user-interaction.ts`：`projectUserInteraction` 对 `select` / `multiselect` 一律产出 `select` 段，删除 `actionsFor` 里的 `<= 10`；`instructionFor` 不再固定写「可以点击按钮」，提示文案改由降级函数按实际结果填写（有按钮 / 部分有按钮 / 只能回序号三种文案，放进 `interaction-messages.ts`）。

### 4. 降级报告：同一组函数，给真实发送和预览共用

1. 把 `projectOutboundPayload` 拆成两层：
   - `resolveSegmentPolicy(adapter, snapshot, kind)`：读适配器声明，**按会话类型解析**（`default` 与 `private / group / channel / thread` 合并，修 F1），返回不可变的 `ResolvedSegmentPolicy`。
   - `projectForSegmentPolicy(payload, policy, { htmlRenderer?, remember?, signal? })`：纯投影，只依赖传入的策略，返回 `{ payload, report }`。
   `projectOutboundPayload` 变成两者的组合，行为不变。
2. 报告条目：

   ```ts
   interface OutboundDegradation {
     readonly index: number;                       // 原 payload 中的位置
     readonly from: string;                        // 原段类型，如 'keyboard'
     readonly to: 'text' | 'image' | 'keyboard' | 'dropped' | 'rejected';
     readonly capability: string;                  // 'messaging.segments.interactive.buttons'
     readonly declared: string;                    // 目标的声明值，如 'text'
     readonly reason: OutboundFallbackReason | 'segment_unsupported' | 'select_overflow' | 'stream_unsupported';
     readonly detail?: Readonly<Record<string, number | string>>; // 如 { buttons: 4 }、{ width: 540 }
   }
   ```

   `RuntimeMessageRendering.fallbacks` 由 `report` 派生（`[...new Set(report.map(r => r.reason))]`），现有观察者不受影响。`segments.supported` 拒绝整条消息时不再只抛错：投影返回 `to: 'rejected'` 的条目，真实发送路径再据此抛出原来的 `EndpointDeliveryError('unsupported_operation')`。
3. 报告只描述「最终交给端点的载荷」，与 `RuntimeMessageRendering` 的注释一致：不声称远端客户端的实际显示。

### 5. 流式进入画像

`MessagingCapabilities` 新增 `streaming?: { mode: 'native' | 'edit' | 'none'; formats?: ('text' | 'markdown')[] } | false`（校验表加在 `capability-profile.ts` 的 `messaging` 节点）。装配期检查：画像声明了流式但端点 spec 没有 `streaming`，或反之，记警告（不 fail，避免一次性破坏 24 个适配器；P4 后改为 fail）。预览据此决定是否展示中间修订（§7.4）。

### 6. 测试策略

| 层 | 测试 | 断言 |
|---|---|---|
| core | `packages/im/core/tests/plugin-runtime/outbound-sandbox-parity.test.ts`（新） | 用 Sandbox 的真实定义建快照，对 `OUTBOUND_SEGMENT_CATALOG` 的每个示例各投影一条（单段消息 + 一条混合消息）：`report` 为空、输出段类型与输入一一对应、`rendering.fallbacks` 为空 |
| core | `outbound-degradation-report.test.ts`（新） | 每个降级函数的每个分支产出正确条目；`fallbacks` 与旧实现一致（对旧快照做等价测试） |
| core | `select-policy.test.ts`（新） | `native / buttons / text` 三档；`maxTotal` 溢出；提示文案随结果变化；`select` 超 10 项在 Sandbox 保持原生 |
| adapter | `plugins/adapters/qq/tests/scene-segments.test.ts`（P0 已加；`@zhin.js/adapter` 不能依赖 QQ 包，所以放在 QQ 适配器里）、`packages/im/core/tests/plugin-runtime/outbound-scene-segments.test.ts`（P0 已加） | QQ `channel` 解析后不含 `card / share`，投影拒绝频道里的图文卡片；按会话类型（含 `thread`）覆盖的 `segments` 改变投影（F1） |
| sandbox 端到端 | `plugins/adapters/sandbox/tests/sandbox-capability-parity.test.ts`（新，沿用 `sandbox-core-interaction.test.ts` 的真实 WS 搭建） | 经 `ImRuntime` 真实发送目录中每种段各一条，客户端收到的 `content` 与发送前的 canonical 段类型完全一致；流式回复收到多个 `revision` |
| sandbox 页面 | `tests/sandbox-segment-renderers.test.ts`（新） | `Object.keys(SANDBOX_SEGMENT_RENDERERS)` ⊇ 目录类型；每个示例渲染结果不含 `sandbox-segment-note`（即没落入 `[type]` 兜底）；`html` 无宽度时按 540 排版 |
| 画像 | `tests/sandbox-profile-ceiling.test.ts`（新） | Sandbox 画像在每个出站能力上都是最高档（遍历 `AdapterSegmentPolicy` 的字段，新增字段时测试先失败，逼着同时更新 Sandbox） |
| 预览 | `tests/sandbox-preview.test.ts`（新） | 对目录 × 预览目录中的每个适配器做快照：icqq + `keyboard` → `text`、标注为按钮模板；QQ `channel` + `share` → `rejected`；无 html-renderer 时 icqq 的 `html` → `text` 且原因是 `renderer_unavailable` |
| 守卫 | `scripts/check-no-platform-branches.mjs` | `ROOTS` 增加 `plugins/adapters/sandbox/src`、`plugins/adapters/sandbox/pages` |

「Sandbox 不走降级路径」的判定口径：core 报告为空 **且** 页面没有一种段落入兜底渲染。两条都要守，前者防声明退化，后者防渲染器缺失。

### 7. 「按平台预览」开关

#### 7.1 平台从哪里来

预览目录 = **官方适配器画像目录** ∪ **当前项目已安装的适配器**（已安装的覆盖目录里同名条目，版本更准）：

- 每个官方适配器把静态画像拆到无依赖的 `plugins/adapters/<name>/adapters/<name>/profile.ts`，`index.ts` 引用它（机械改动，24 个文件）。
- 构建脚本 `scripts/generate-adapter-profile-catalog.mjs` 把它们汇总成 `@zhin.js/adapter` 内的 `adapter-profile-catalog.json`（`{ key, displayName, version, profile }[]`，`displayName` 取各适配器 `src/console.ts` 的 `adapterDisplayName`）。Sandbox 不依赖任何其他适配器包，不会把 icqq 之类的依赖带进安装体积（ADR 0019）。
- 已安装适配器的画像从运行时快照读（`snapshot.capabilities` 中 `adapterFeatureId` 的槽位）。

选项列表就是这份数据，按显示名排序，Sandbox 固定在第一位。页面代码只做数据查找，不出现 `'icqq'` 之类字面量。

#### 7.2 怎么投影

- 预览只改**显示**（推荐，见 D2）：Sandbox 端点照常收到为 Sandbox 投影好的完整载荷，交互仍按 Sandbox 的原生按钮登记。
- 页面在 Sandbox 现有的 WS（`/sandbox`，权限 `ENDPOINT_OPERATE`，见 `packages/console/protocol/src/permissions.ts:673`）上新增两个帧，不新增 RPC，因此不用改权限映射：
  - `{ type: 'preview.project', target: { key, kind }, items: [{ messageId, segments }] }` → 端点调用 `projectForSegmentPolicy(segments, resolveSegmentPolicyFromProfile(profile, kind), { htmlRenderer })` 逐条返回 `{ messageId, segments, report }`。纯函数、不发送、不登记按钮回调。
  - 新消息到达时，页面若处于预览模式，按同样方式请求投影（批量、带去抖）。
- `kind` 取当前会话类型（私聊 / 群 / 频道），所以同一平台在不同会话下的差异（QQ 群 vs 频道）也能看到。
- HTML：只有当前项目装了 html-renderer 时，`image` 策略才产出真实 PNG；默认不渲染图片，按设计宽度显示 iframe 并标注「会以 540px 宽图片发送」（D6）。

#### 7.3 标注

标注 = 报告条目 × 固定模板（`pages/index/messages.ts` 中按 `reason` / `capability` 取文案，`{platform}` 填显示名）：

| 报告 | 标注（zh-CN） |
|---|---|
| `keyboard → text`，`interactive_text_policy` | {platform} 不支持按钮，这里退化成了序号列表，用户回复数字作答 |
| `select → keyboard`，`select_overflow` | {platform} 最多 {max} 个按钮，后 {rest} 项只能回复序号 |
| `select → text` | {platform} 没有选择列表，这里退化成了序号列表 |
| `markdown → text` | {platform} 不支持 Markdown，格式会被去掉 |
| `html → image` | {platform} 会把卡片渲染成 {width}px 宽的图片发送 |
| `html → text`，`renderer_unavailable` | 当前项目没有安装 HTML 渲染器，{platform} 只会收到纯文本 |
| `image → text`，`media_unsupported` | {platform} 只能发链接形式的媒体，这张图会变成文字「{alt}」 |
| `rejected`，`segment_unsupported` | {platform} 不支持「{segment}」，整条消息不会发出 |
| `stream_unsupported` | {platform} 不支持流式输出，用户只会看到最终消息 |

每条消息下方汇总一行（可展开看逐段），页面顶部常驻一句「按 {platform} 的能力画像预览；平台客户端的实际显示可能还有差异」。

#### 7.4 流式

预览目标不支持流式时，页面只显示最终修订，中间修订折叠成一行「生成中…」，并加 `stream_unsupported` 标注。这一项完全在页面侧，读 §5 的画像字段。

## 备选方案及否决理由

| 方案 | 否决理由 |
|---|---|
| A. Sandbox 页面里手写一张「各平台支持什么」的表 | 与适配器声明两处维护，必然漂移；违反 ADR 0044「平台差异集中在适配器」 |
| B. 预览时把 Sandbox 的能力画像临时换成目标平台的（真实走一遍降级与回数字登记） | 能力槽位按代（generation）冻结，换画像要重装配；同一 Sandbox 的多个会话会互相影响。保留为 P5 的「模拟模式」，届时用按会话的 `outboundPresentationToken` 收窄实现，而不是换画像 |
| C. 在浏览器里重写一份降级函数 | 两份实现；HTML 渲染、媒体策略依赖 Node 侧能力 |
| D. 预览只列已安装的适配器 | 新用户在 Sandbox 里试用时通常只装了 Sandbox，开关会是空的 |
| E. 继续用 `keyboard` 表达选择器、只把 10 的上限挪进 QQ | 解决了 G1，但 G2、G3 仍在；有原生选择器的平台永远用不上 |

## 决定

所有者 2026-11-16：「按推荐的来，先做 P0 和 P1」。下表每一项都采用「推荐」一列；被否决的选项见「备选方案及否决理由」与各项问题本身。

| # | 问题 | 推荐（即决定） |
|---|---|---|
| D1 | 预览的平台列表来源 | 官方画像目录 ∪ 已安装适配器（§7.1） |
| D2 | 预览只改显示，还是完整模拟（回数字、按钮回调都按目标平台走） | 先只改显示；模拟模式放 P5，视反馈再做 |
| D3 | 是否新增 core 扩展段 `select`（同时修 `select-over-10-options-no-buttons`） | 新增 |
| D4 | `interactive` 声明从字符串扩展为对象，字符串保留为简写 | 扩展 |
| D5 | HTML 设计宽度：core 在 `direct` 分支给段盖章 `width: 540`，还是只导出常量由页面读 | core 盖章：所有 `direct` 端点（Sandbox、Email）看到一致的宽度 |
| D6 | 预览时是否真的把 HTML 渲染成图片 | 默认不渲染，只按宽度显示并标注；装了渲染器时提供「生成真实图片」按钮 |
| D7 | 端点编解码器里的隐性降级（F3） | 能声明的提升为画像字段（按钮上限、按钮必须配 Markdown）；其余在标注里注明「仅按能力画像预览」，不在 Sandbox 里模拟 |
| D8 | F1（按会话类型的 `segments` 不生效）与 F2（GitHub 未声明 Markdown 原生）是否在本 ADR 内先修 | 先修，作为 P0，否则预览第一天就会给出误导性标注 |
| D9 | Sandbox 是否实现并声明引用、撤回、编辑、表情回应等非段能力 | 纳入（P1b）：它们同样是「zhin 能做出什么效果」，且 Sandbox 已有 `edit` 帧（流式修订）可复用 |
| D10 | 「Sandbox 不走降级」的判定口径 | core 报告为空 + 页面无兜底渲染（§6），两条都进 CI |
| D11 | 流式画像与端点 spec 不一致时 | 先告警，P4 完成后改为装配失败 |

## 分阶段实施

| 阶段 | 内容 | 主要落点 | 估计规模 |
|---|---|---|---|
| P0 画像修正（已实施） | F1：`resolve*` 按会话类型解析 `segments`；F2：GitHub 声明 `markdown: 'native'`（并核对 `formatOutboundBody` 对 `markdown` 段的输出）；对应测试 | `packages/im/core/src/plugin-runtime/im/outbound-segments.ts`、`outbound-renderer.ts`、`plugins/adapters/github/adapters/github/index.ts` | 小：约 150–250 行，1 个 PR |
| P1 Sandbox 全能力 + 守卫 | 段目录 `catalog.ts`；补 `file / link / qrcode / tts` 渲染器、`share` 音频、HTML 默认 540 宽、Markdown 解析器补齐；渲染器拆文件并导出映射；画像加 `streaming` 字段（§5）并由 Sandbox 声明；§6 中 core 对等、端到端、页面渲染器、画像上界四个测试 | `packages/im/core/src/built/segment-contract/`、`packages/im/adapter/src/capability-profile.ts`、`plugins/adapters/sandbox/{adapters,pages,tests}`、`packages/console/client/client/message-content/markdown.ts` | 中：约 700–1000 行，2 个 PR（core / adapter 一个，Sandbox 页面一个） |
| P1b 非段能力（D9） | Sandbox 端点实现引用、撤回、编辑、表情回应的 control 操作并声明 | `plugins/adapters/sandbox/src/endpoint.ts`、`protocol.ts`、页面 | 中：约 400–600 行，可与 P2 并行 |
| P2 降级报告 | 拆 `resolveSegmentPolicy` / `projectForSegmentPolicy`；`OutboundDegradation`；`fallbacks` 由报告派生；`rejected` 条目；等价测试 | `packages/im/core/src/plugin-runtime/im/` | 中：约 400–600 行，1 个 PR |
| P3 选择器段 | `select` 段、`interactive` 对象形式、`applyOutboundSelectPolicy`、`user-interaction.ts` 去掉 `<= 10` 与固定文案；Sandbox 原生单选 / 多选；QQ 声明按钮上限 | `packages/im/core/src/built/{user-interaction.ts,interaction-messages.ts,interactive-segments/}`、`packages/im/adapter/src/definition.ts`、`plugins/adapters/{sandbox,qq}` | 大：约 900–1300 行，2 个 PR（core + 适配器声明；Sandbox 渲染）。Telegram / Discord / Lark 原生选择器另开 issue |
| P4 按平台预览 | 24 个适配器拆 `profile.ts`（机械改动）；画像目录生成脚本；WS 帧 `preview.project`；页面开关、标注、流式折叠；守卫扩到 Sandbox；预览快照测试 | `plugins/adapters/*/adapters/*/profile.ts`、`scripts/`、`packages/im/adapter/`、`plugins/adapters/sandbox/` | 大：约 1000–1400 行（其中约 400 行机械改动），2–3 个 PR |
| P5（可选）模拟模式 | 按会话的展示收窄，真实走目标平台的降级与回数字登记 | `outbound-renderer.ts` 的 `outboundPresentationToken` 扩展 | 中：视 D2 反馈再定 |

依赖：P0 → P2 → P4；P1 可与 P0 并行；P3 依赖 P2 的报告结构（`select_overflow`）。最短可交付路径：P0 + P1 先满足「Sandbox 全能力」的约定，P2 + P4 交付预览，P3 单独交付选择器。

## 风险

1. **画像不等于实际显示**。报告只描述交给端点的载荷；QQ 客户端版本差异、端点编解码器里的规则（F3）都看不到。缓解：页面常驻说明、D7 把能声明的规则提升进画像。
2. **`interactive` 类型扩展影响第三方适配器**。字符串简写保持原义；`readDeclaredInteractivePolicy` 对未知形状按 `text` 处理（没声明 = 不支持）。
3. **`select` 段对未升级的适配器**。降级在 core 内完成，适配器只会看到 `keyboard` 或 `text`；但直接构造 `select` 段的第三方插件在旧版 core 上会被 `assertCanonicalSegments` 拒绝——需在 changeset 中注明最低版本。
4. **拆 `projectOutboundPayload` 有行为回归风险**（它在 `outbound-delivery-runtime.ts:102 / :189` 两处被调用，包括中间件替换后的再投影）。缓解：P2 先做新旧实现的等价测试再切换。
5. **画像目录与已安装版本不一致**。已安装的优先；目录条目带版本号，页面显示「按 v1.x 画像」。
6. **预览帧被滥用做大量投影**。只在 `ENDPOINT_OPERATE` 下可用、按连接限速、单批条数上限；不调用 HTML 渲染器（除非用户点了「生成真实图片」）。

## 验收标准

1. 目录中的每种出站段经 Sandbox 真实发送一条：core 报告为空，页面无一落入兜底渲染；新增一种段而不加 Sandbox 渲染器时 CI 失败。
2. `点歌 晴天`（20 项）在 Sandbox 里是可滚动的原生选择列表；切到 QQ 官方预览时前 N 项是按钮、其余是序号，并有 `select_overflow` 标注；切到 icqq 预览时是序号列表，并有「icqq 不支持按钮…」标注；任何情况下提示文案都与实际情况一致。
3. 不带 `width` 的 HTML 卡片在 Sandbox 里按 540px 排版并等比缩放。
4. 切到 QQ 官方、在频道会话里发图文卡片，预览标注「整条消息不会发出」，与真实发送结果一致（F1 修正后）。
5. 切到 GitHub 预览时 Markdown 保留格式（F2 修正后）。
6. `check:no-platform-branches` 覆盖 Sandbox 源码与页面并通过。

## 实施记录

### P0（2026-11-16）

- **F1**：`outbound-segments.ts` 的 `resolveOutboundHtmlPolicy`、`resolveOutboundMediaPolicy`、`resolveOutboundInteractivePolicy`、`resolveOutboundMarkdownPolicy`、`resolveOutboundSupportedSegments` 增加可选参数 `conversation`（`{ kind, threadId? }`），`resolveAiOutboundSegments` 的第三个参数除会话类型外也接受会话本身。解析顺序与画像其他字段相同（`default` → 会话类型段 → 有 `threadId` 时的 `thread` 段，见 `resolveStaticCapabilities`）；`segments` 是画像里的整体字段，类型段写了就整段替换，没写的类型沿用 `default`（即 `definition.segments`）。不传会话时行为与之前完全一致。`projectOutboundPayload`、指令菜单翻页（`command-feedback.ts`）与 Agent 的回复段解析（`ingress-outbound.ts`）都传入当前会话。
- **受影响的适配器**：官方适配器里只有 QQ 官方在类型段（`channel`）声明了 `segments`。修正后频道会话的 `supported` 不再含 `card` / `share`：模型在频道里看不到图文卡片段，手写的图文卡片在投影阶段以 `unsupported_operation` 拒绝（不再交给端点）；私聊、群聊不变。其他 23 个官方适配器只在 `default` 声明，行为不变。
- **F2**：GitHub 适配器声明 `markdown: 'native'`。`formatOutboundBody` 之前没有 `markdown` 分支（`markdown` 段一直先被 core 转成纯文本，所以没有暴露），现在把 `markdown` 段的源文本作为独立的块原样写进评论正文，与相邻的行内文本用空行分隔。HTML 与媒体策略不变（`html` 仍按 `image` → 仅 URL 媒体 → 文本）。

## 增补：入站能力对齐（2026-11-17）

状态：已接受（所有者授权按推荐处理，2026-11-17）。来源：zhinjs/zhin#1250 评论 6935124915 的 `sandbox-inbound-capability-parity` 与 `sandbox-typed-media-syntax-sent-as-text`。本增补新增 D12–D17 与阶段 I0–I4，全部按「推荐」一列执行；I0 已在 #1250 第 42 批实施，I1–I4 未开始。核对基线：`origin/feat/friendly-volta-ejc3wl`（2e46abe2d）。

前面各节管的是**机器人发出去**的消息在 Sandbox 里怎么显示。本增补管另一侧：**用户发进来**的消息，Sandbox 应当能模拟各平台的入站能力（本地媒体、引用、平台事件），让插件和 Agent 在 Sandbox 里收到的东西和在真实平台上一样。原则和 §0 相同：Sandbox 的运行时代码不出现平台名分支；产出的入站段、`replyTo` 和事件都走真实适配器使用的那条 core 路径，不另写一套。

### 1. 现状（逐项核实）

| # | 能力 | 现状 | 位置 |
|---|---|---|---|
| N1 | 手打的媒体写法 | **I0 已修**。修之前：编辑器只把按钮插入的节点变成 `image` / `video` / `audio` 段，手打的 `[image:URL]` 原样成为 `text` 段；端点只展开 `[@名称]`；页面预览另用一个正则（`SandboxChat.tsx` 的 `parseTextToSegments`）把它显示成图片，所以「看起来能用、发出去是文字」。「快捷操作与语法」还把 `**文本**`、```` ``` ```` 列为写法，这两项发送时也不解析成段（只是气泡按 Markdown 显示） | `pages/index/RichTextEditor.tsx` `parseEditorContent`、`src/protocol.ts` `expandTypedMentions` |
| N2 | 本地图片、文件、语音 | 只能插入 URL（图片 / 视频 / 音频三个按钮，没有文件）；没有拖放，没有「选择文件」；粘贴图片被读成 `data:` URL 放进 `media.kind: 'url'`（I0 改为 `kind: 'base64'`）。整条消息走 `/sandbox` WebSocket 帧，网关桥的单帧上限是 16 MiB（`packages/host/http/src/bridge/protocol.ts` `maxWsMessageBytes`），而且 base64 会把体积放大约三分之一 | `RichTextEditor.tsx` `handlePaste`、`SandboxChat.tsx` `commitMediaUrl` |
| N3 | URL 被挡 | Agent 的入站媒体（`turn/inbound-media.ts` → `media/media-normalize.ts` `normalizeMediaRefsToPayloads` → `fetchUrlAsBase64`）对每一跳都用 `checkUrlNetworkAccess(url, { httpsOnly: true, allowedDomains })`，并用 `hostnameResolvesToBlockedAddress` 拒绝解析到私有地址的名字。实测：`data:image/png;base64,…` 被拒（「仅支持 HTTP/HTTPS」），`http://127.0.0.1:8086/…` 被拒（「仅允许 HTTPS」）。所以「Sandbox 起一个本机地址给插件下载」这条路，不改 core 时 Agent 也看不到图；插件自带的域名白名单同理 | `packages/im/agent/src/security/network-policy.ts` |
| N4 | 引用 / `replyTo` | 页面没有「引用」操作，只能显示出站的 `reply` 段（`segments/basic.tsx` `renderReply`，只有 `#id`）。**入站链路其实已经齐了**：`promoteInboundMessagePayload`（`packages/im/adapter/src/inbound-promotion.ts`）从入站 `reply` 段提升 `replyTo`；被引用消息由 `ImRuntime.resolveConversationReference`（`im-runtime.ts`）解析，先查会话事件存储（`conversation-runtime.ts` `resolveLocal`，已撤回的不返回），找不到再问端点的 `EndpointContentPort.resolve`。Sandbox 端点没有实现 content port（官方适配器里只有 Telegram 实现）。入站消息的 id 是页面生成、帧里带上的 `messageId`（端点已采用为入站 id） | `src/endpoint.ts`、`packages/im/agent/src/session/turn-quote.ts` |
| N5 | 平台事件 | 端点只上报 `message`（原始帧另作为 `platform('message')`）和连接事件，没有 notice / request 入口。core 已能把 `poke`、`emoji_reaction`、`recall`、成员变动等 notice 映射成会话事件（`conversation-runtime.ts`，如 `conversation.poked`、`message.reaction_changed`），但 Sandbox 发不出这些事件。合并转发：canonical `forward` 段存在（`{ forward_id, title?, messages: Segment[][] }`，`segment-contract/json-schema.ts`），页面能显示出站转发，入站没有构造入口；另外 Agent 的引用摘要读的是 `data.entries`（带发送者），与 canonical 的 `messages` 不是同一形状 | `src/endpoint.ts` `#emitPlatformEvent`、`turn-quote.ts` `summarizeSegments` |

### 2. 决策

#### D12 本地文件由 Sandbox 托管：存在哪里、地址怎么签发、多大、多久、谁能读

1. **存储位置**：项目的 `.zhin/sandbox/media/<端点键的 SHA-256 前 16 位>/` 下，每个对象两份文件：`<id>`（字节）和 `<id>.json`（`kind`、`mime`、`size`、`name`、`sha256`、`createdAt`、`expiresAt`、上传者 principal id、会话）。`id` 是 128 位随机数的 base64url（`^[A-Za-z0-9_-]{22}$`）。**磁盘上的文件名只用 `id`**，上传者给的文件名只进元数据；读取只按 `id` 查元数据，不接受任何路径。`.zhin/` 已在 Agent 的检索范围之外（`plugin-runtime/file-search-scope.ts`），I1 同时用测试确认 `read_file` 的文件策略也拒绝这个目录。不放内存：重启后，页面历史里的图片还能显示、引用还能解析（在有效期内）。
2. **大小**：单个文件按类型设上限，默认图片 10 MiB、语音 / 音频 20 MiB、视频 50 MiB、其他文件 50 MiB；每个端点总配额默认 500 MiB，超过时先删最早到期的对象，仍不够则拒绝上传（`quota_exceeded`）。都可在端点配置 `media`（`schema.json`）里调小或调大，上限值本身也有硬顶（单文件 200 MiB、配额 5 GiB），避免配置错误把磁盘写满。比 Agent 多模态上限（`maxFileBytes`）大的文件照样能上传——插件可能要处理大文件——Agent 一侧按它现有的结局（`media_validation_failed`）如实报告。
3. **有效期**：默认 24 小时（`media.ttlHours`，1–168）。端点启动时和之后每小时清扫一次过期对象；过期后下载返回 404，content port 返回 `expired`。
4. **地址签发**：插件拿到的是 `<origin>/pub/sandbox-media/<id>?exp=<到期秒>&sig=<签名>`，`sig = base64url(HMAC-SHA256(secret, 端点键 \0 id \0 exp))`。`secret` 为 32 字节随机数，存 `.zhin/sandbox/media/secret`（权限 0600），重启不变；`exp` 等于对象的 `expiresAt`，所以链接和文件同时失效。`origin` 取 `HttpHost.address`（插件进程能连到的监听地址）。签名只证明「这是 Sandbox 签发的这个对象」，不代替下面的访问控制。
5. **访问控制**，两条入口：
   - **Console 页面**显示自己的上传：`GET /api/sandbox/media/<id>`，在 `CONSOLE_HTTP_PERMISSIONS` 登记为 `endpoint.view`（前缀规则），并要求 principal 的授权范围覆盖该端点（`bindingScopeCovers`）。
   - **插件与本机进程**：`GET /pub/sandbox-media/<id>?exp&sig`，必须签名正确、未过期，并且**默认只接受回环来源**（`RouteContext.remoteAddress` 为 `127.0.0.1` / `::1`，或进程内调用）。签名错、过期、非回环一律返回 404，不区分原因，不泄露对象是否存在。只有在端点配置 `media.publicDownload: true` 时才接受非回环来源；文档写明这等于生成**限时外链**，只在远程部署、需要外部服务取文件时打开。
6. **不变成任意文件读取**：路由只认 `id`；响应的 `Content-Type` 取上传时按魔数校验过的类型，统一带 `X-Content-Type-Options: nosniff`；图片、音视频 `inline`，其余 `attachment`。不接受 `image/svg+xml`、`text/html` 等浏览器会执行的类型作为图片（按 `file` 存，强制 `attachment`）。

#### D13 上传入口与入站段格式：与真实平台对齐

1. **页面入口**：输入区支持拖放、粘贴（图片和文件）、「附件」按钮选择本地文件；语音可以选本地音频文件，浏览器支持 `MediaRecorder` 时再提供「录音」按钮（不支持时不显示）。控件全部用 `@zhin.js/console-ui`（ADR 0063：文件选择用 console-ui 的 `Button` 触发隐藏的文件输入，上传进度、失败提示用已有的通知样式），并通过 `pnpm check:plugin-ui-audit`。
2. **上传通道**：`POST /api/sandbox/media?endpoint=<id>`，请求体是原始字节（不用 multipart），带 `Content-Type`、`Content-Length`（必填）和 URL 编码的 `X-Zhin-File-Name`；在 `CONSOLE_HTTP_PERMISSIONS` 登记为 `endpoint.operate`（与 `/sandbox` WebSocket 相同），只读连接拒绝。服务端边接收边计数，超过上限立即中断（413），写完按魔数判断类型：魔数是图片 / 音频 / 视频的按对应类型，其余一律 `file`；声明的 `Content-Type` 与魔数不符时以魔数为准。Sandbox 自带一张魔数表，与 `media-normalize.ts` 的 `sniffMedia` 对齐，测试用同一组样本比对两者。不走 WebSocket 帧：避免 base64 膨胀和 16 MiB 单帧上限，上传失败也不影响会话连接。
3. **入站段**：按多数平台（OneBot / QQ / Milky 等）的做法，入站媒体带一个可下载的 URL：
   ```ts
   { type: 'image', data: { media: { kind: 'url', value: '<D12 的签名地址>', mime_type, size, file_name } } }
   ```
   语音用 `audio`（core 已把 `record` / `voice` 归一为 `audio`），能读出时长时带 `duration`；视频用 `video`；其他用 `file`，并带 `data.name`。这些段由 I0 的 `sandboxInboundMediaSegment` 构造（加可选元数据参数），所以上传、按钮插入、手打写法三者产出同一种段。
4. **粘贴图片改走上传**：I1 起粘贴的图片先上传，再插入托管地址，不再把 base64 塞进消息和历史；手打的 `data:` 写法仍然接受（I0 的行为不变）。

#### D14 Sandbox 托管地址是「本机可信来源」，边界写死

问题见 N3：Agent 只取 https、拒绝私有地址，插件自己的域名白名单也会挡住本机地址。推荐（即决定）：**按「谁签发」放行，不按域名或 IP 放行**。

1. core 新增「本机媒体来源」端口，形状参照已有的 `ImageAssetPublisher.ownsUrl`（`packages/im/agent/src/media/image-assets.ts`：「只有这个发布者命名空间里的 URL 可以绕过模型 URL 抓取」）：
   ```ts
   interface LocalMediaSource {
     ownsUrl(url: string): boolean;
     read(url: string, options: { maxBytes: number; signal?: AbortSignal }): Promise<LocalMediaBytes | null>;
   }
   ```
   以作用域 token（`localMediaSourcesToken`，可有多个来源）提供；Sandbox 端点在 `setup` 里注册自己的来源，随 generation 卸载。
2. `normalizeMediaRefsToPayloads` 在走网络之前先问已注册的来源：`ownsUrl` 为真时**只**调用 `read`，绝不再发网络请求，也不受 `httpsOnly` / `allowedDomains` 影响；`ownsUrl` 为真但 `read` 返回空（签名错、过期、超过 `maxBytes`、类型不符）就是失败，**不回退到网络**，防止有人造一个「看起来像本机」的地址诱发请求。
3. 边界：
   - `ownsUrl` 只做筛选：origin 与 Host 当前监听地址完全相同、路径以 `/pub/sandbox-media/` 开头、`id` 合法。真正的授权在 `read` 里：校验 HMAC 与有效期，然后只按 `id` 读 Sandbox 媒体存储里的对象。
   - `127.0.0.1` 上的其他路径、其他端口、`localhost` 等别名都**不**受信任，仍按原网络策略拒绝。
   - `read` 的结果按调用方的 `maxBytes` 截断即失败，按魔数再校验一次类型。
   - 没有网络请求，也就没有重定向可跟随。
   - Sandbox 没加载时，没有任何地址受信任。
   - 模型在回复里引用同一个地址也能读到（相当于引用用户发来的图），但只限这个对象，读不到本机其他任何资源。
4. 插件侧：core 新增 `readMediaRef(ref, { maxBytes, signal, network? })`（先问本机来源，再按调用方给的网络策略取）和 `isLocalMediaUrl(url)`（插件自己做域名白名单时用它放行），由 `zhin.js` 再导出。插件直接 `fetch(url)` 也能下载（签名地址 + 回环来源，见 D12），README 写明两种用法。

#### D15 引用、`replyTo` 与平台查询的模拟

1. **操作**：页面每条消息（用户的和机器人的）在消息操作里加「引用」（console-ui 的图标按钮 + 提示）。点击后输入区上方出现引用条（被引用者、摘要、取消），发送时在 `content` **最前面**加 canonical `reply` 段 `{ type: 'reply', data: { message_id } }`，与 OneBot / QQ 把回复段放在最前的习惯一致。
2. **`replyTo` 不手写**：由 `promoteInboundMessagePayload` 从 `reply` 段提升，与其他适配器同一条路径，所以命令、Handler、Agent 看到的 `message.replyTo.id` 与真实平台一致。
3. **id**：用户消息用帧里的 `messageId`（端点已采用为入站 id）；机器人消息用出站回执里的 id（页面收到的出站帧带 `messageId`）。I3 用测试确认两者与会话事件存储里记录的 id 相同。
4. **查询模拟**：插件或 Agent 查询被引用消息时，走既有的 `resolveConversationReference`：先查会话事件存储（Sandbox 的入站、出站消息都在里面），找不到再问端点。Sandbox 端点实现 `EndpointContentPort.resolve`：Sandbox 没有独立于会话事件的消息库，所以消息引用一律返回 `not_found`（`code: 'message_not_found'`，模拟平台上「消息已过期 / 已撤回」），不返回 `unsupported`；测试守住这一点，避免引用在 Sandbox 里被当成「平台不支持」。
5. **显示**：`reply` 段的渲染从「↩ 引用消息 #id」改为被引用者 + 摘要（在页面本地消息列表里查，查不到时显示 id）。
6. 画像：Sandbox 已声明 `quote: true` 与 `actions.quoteReply`（出站），本项不改画像。

#### D16 平台事件的入口

1. **页面**：消息操作和会话工具栏的「更多」菜单（console-ui `DropdownMenu`）提供：戳一戳（机器人或某成员）、对某条消息加 / 取消表情回应、撤回自己发的消息、合并转发（勾选若干条消息，生成一条 `forward` 入站消息）、群聊里的成员进群 / 退群；加好友 / 加群请求放在最后（需要走 `request.approve` / `request.reject` 的既有 RPC）。
2. **线协议**：`/sandbox` WebSocket 新增 control 帧 `{ op: 'event', conversation, event: { name, … } }`，与 `subscribe` 一样不进聊天流；端点校验后经 `this[endpointSpec].events.emit('notice.<会话类型>.<名字>', …)` 上报，名字取 core `conversation-runtime.ts` 已识别的那一组（`poke`、`emoji_reaction`、`recall`、`increase` / `decrease` 等，I4 开工前核对完整列表并在测试里逐个枚举），这样 core 的会话事件、Agent 的场景事件和真实平台走同一条映射。
3. **身份**：事件的操作者固定是当前发送者，模拟身份规则与消息相同（ADR 0060 §5.4 的 `~sim:` 前缀）；不能以机器人自己的身份发事件；只读连接一律拒绝。
4. **合并转发的形状**：页面按 canonical `forward` 段构造（`forward_id` 随机、`messages` 为段的二维数组）。Agent 引用摘要读的 `data.entries`（带发送者）与 canonical 不一致（N5），I4 先在 core 统一：推荐给 canonical `forward` 增加可选的 `entries: { actor?, segments }[]`，`messages` 保留，摘要两者都读。这会改 canonical schema 与类型，是 `@zhin.js/core` 的 minor，单独请所有者批准；不批准时 I4 的合并转发只填 `messages`，摘要里不显示发送者。

#### D17 「快捷操作与语法」只列真的会解析的写法（I0 已实施）

写法表与解析器是同一份数据（`plugins/adapters/sandbox/src/inbound-syntax.ts` 的 `SANDBOX_INBOUND_SYNTAX`）：页面的提示列表直接渲染这张表，页面发送、预览、端点收帧都用它的解析器，编辑器按钮插入的段也由同一组函数构造。以后新增写法（例如 `[reply:ID]`）必须同时加进表和解析器，守卫测试（`tests/sandbox-typed-syntax.test.ts`）在两者不一致时失败。

### 3. 安全考虑

| 风险 | 措施 |
|---|---|
| 上传撑满磁盘 | 单文件按类型限额、端点总配额、配置值的硬顶、到期清扫（D12） |
| 上传可执行内容 | 按魔数判定类型、`nosniff`；SVG / HTML 不作为图片，强制 `attachment`（D12.6） |
| 托管地址变成任意文件读取 | 路由与 `read` 只接受随机 `id`，磁盘文件名只用 `id`，从不拼接用户给的路径（D12.1） |
| 托管地址变成公开外链 | 签名 + 到期 + 默认只接受回环来源；Console 入口要 `endpoint.view` 且范围覆盖该端点；`publicDownload` 默认关闭并在文档里写明含义（D12.5） |
| 借「本机可信」做 SSRF | 按签发者放行，不按域名 / IP；`ownsUrl` 命中后不回退到网络；其他本机路径、端口、别名不受信任（D14.3） |
| 上传冒用他人或机器人身份 | 上传与事件都在 `endpoint.operate` 下，元数据记录上传者 principal；事件操作者固定为当前发送者（D13.2、D16.3） |
| 审计 | 每次上传写一条实例日志（principal、端点、类型、大小、`id`，不含内容） |

### 4. 分阶段计划

| 阶段 | 内容 | 要改的文件 | 测试 | 发布级别 |
|---|---|---|---|---|
| I0 手打写法（**已实施**，第 42 批） | D17；粘贴图片改 `base64` 引用；只含媒体的消息纯文本不再回退成原始帧 | `plugins/adapters/sandbox/src/inbound-syntax.ts`（新）、`src/protocol.ts`、`pages/index/{SandboxChat.tsx,RichTextEditor.tsx,messages.ts}`、`README.md` | `tests/sandbox-typed-syntax.test.ts`（新：手打生成图片段、按钮与手打一致、不合法 URL 保留为文本并提示、写法表与解析器一致的守卫、端点展开）；`sandbox-typed-mention.test.ts` 不变通过 | `@zhin.js/adapter-sandbox` patch；无新增公开导出 |
| I1 本地文件托管与上传 | D12、D13：媒体存储、签名、两条下载路由、上传路由、页面拖放 / 粘贴 / 选择文件 / 录音、端点配置 `media` | `plugins/adapters/sandbox/src/media-store.ts`（新）、`src/media-routes.ts`（新）、`src/endpoint.ts`、`src/inbound-syntax.ts`、`schema.json`、`pages/index/{RichTextEditor.tsx,SandboxChat.tsx,messages.ts}`；`packages/console/protocol/src/permissions.ts`（登记 `POST /sandbox/media` 为 `endpoint.operate`、`GET /sandbox/media` 前缀为 `endpoint.view`） | 存储：`id` 与路径无关、配额与清扫、魔数判定、SVG 强制附件；路由：签名错 / 过期 / 非回环一律 404、`publicDownload`、Console 入口的范围检查；上传：超限 413、只读连接拒绝；页面：上传后插入的段与 `sandboxInboundMediaSegment` 一致；`tests/contracts` 的权限映射覆盖新路由；`pnpm check:plugin-ui-audit` | `@zhin.js/adapter-sandbox` **minor**（新配置项 `media`、新路由；若 ADR 0064 P1 的 minor 尚未发布则并入同一版本）；`@zhin.js/console-protocol` patch（只在已有常量里加条目，不新增导出） |
| I2 本机可信来源 | D14：`LocalMediaSource` 端口与 token、`normalizeMediaRefsToPayloads` 先问本机来源、`readMediaRef` / `isLocalMediaUrl`；Sandbox 注册来源 | `packages/im/core/src/`（新增端口与两个函数，从包入口导出）、`packages/im/zhin/src/`（再导出）、`packages/im/agent/src/media/media-normalize.ts`、`plugins/adapters/sandbox/src/endpoint.ts` | core：`ownsUrl` 命中但 `read` 失败时不发网络请求（mock `fetch` 断言零调用）、同主机其他路径 / 端口 / `localhost` 别名仍被拒、来源随 generation 卸载；agent：上传的图片进入识图（`inbound-media.ts` 产出图片块，结局不再是 `rejected` / `media_validation_failed`）；sandbox 端到端：上传 → 发送 → Agent 收到 base64 图片块 | `@zhin.js/core` **minor**（新增公开导出）、`zhin.js` **minor**（再导出）、`@zhin.js/agent` patch、`@zhin.js/adapter-sandbox` 随 I1 |
| I3 引用 | D15：消息「引用」操作与引用条、`reply` 段放最前、`replyTo` 经提升、端点 content port、`reply` 段显示摘要 | `plugins/adapters/sandbox/src/endpoint.ts`、`pages/index/{SandboxChat.tsx,segments/basic.tsx,messages.ts}` | 引用用户消息与机器人消息时 `message.replyTo.id` 等于会话事件里的 id；`resolveConversationReference` 先命中本地存储；本地没有时端点返回 `not_found` 而不是 `unsupported`；Agent 的引用摘要包含被引用内容 | `@zhin.js/adapter-sandbox` patch；无新增公开导出 |
| I4 平台事件与合并转发 | D16：control 帧 `op: 'event'`、notice / request 上报、页面「更多」菜单、合并转发 | `plugins/adapters/sandbox/src/{protocol.ts,endpoint.ts}`、`pages/index/`；若批准 D16.4，`packages/im/core/src/built/segment-contract/{json-schema.ts,validate.ts,types.ts}` 与 `packages/im/agent/src/session/turn-quote.ts` | 每种事件经 core 映射成对应的会话事件（逐个枚举）；只读连接与冒充机器人被拒；合并转发通过 canonical 校验，Agent 摘要正确 | `@zhin.js/adapter-sandbox` patch；D16.4 批准时 `@zhin.js/core` **minor**（canonical `forward` 新增可选字段）、`@zhin.js/agent` patch |

依赖：I1 与 I2 一起发布（只有 I1 时插件能下载，但 Agent 看不到上传的图）；I3、I4 不依赖 I1 / I2，可并行。

需要所有者批准、写进 `.changeset/version-policy.json` 的 minor：I1 的 `@zhin.js/adapter-sandbox`、I2 的 `@zhin.js/core` 与 `zhin.js`、I4（仅当采用 D16.4）的 `@zhin.js/core`。

### 5. zhinjs/console 仓库

不需要改动。Sandbox 页面、上传与下载路由、权限映射、网关都在本仓库；Console 只是加载插件页面，上传请求走 `/api`、带 Console 自己的凭据。唯一前提是网关把 `/pub/sandbox-media/*` 转发给实例并带上对端地址（`remoteAddress`）——I1 用端到端测试确认；如果不满足，要改的是本仓库的 `packages/host/gateway`，不是 Console。

### 6. 备选方案及否决理由（入站）

| 方案 | 否决理由 |
|---|---|
| 上传走 `/sandbox` WebSocket 帧（base64） | 体积放大约三分之一，受 16 MiB 单帧限制，大文件会拖住会话连接 |
| 入站媒体用平台引用（`media.kind: 'file'`，Telegram 的 `file_id` 式）+ 端点 content port 返回字节 | 不用改 core（Agent 已能解析平台引用），但插件拿不到可下载的地址，而所有者要的是「给插件一个可下载的地址」；多数平台的入站媒体也是 URL |
| 把 `127.0.0.1` / `localhost` 加进域名白名单 | 等于对本机所有服务开放 SSRF；D14 只信任签发者，不信任地址 |
| 媒体只存内存 | 重启后历史里的图片和引用全部失效 |
| 永久公开链接 | 违背「不得变成公开外链」；签名 + 到期 + 回环默认已覆盖本机插件的需要 |
| 页面里按平台名写不同的入站格式 | 违反 ADR 0044 与 §0.3；入站段只按 canonical 段与多数平台的共同做法构造 |
