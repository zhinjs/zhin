# Toolkit Runtime

Toolkit 提供 **optional peer** 能力与脚手架，不进入 IM 核心默认安装（ADR 0019）。与 `plugins/utils/*` 中已删除的 `voice`、`html-renderer` 插件不同，能力现以 workspace 包形式由 `zhin.js` bootstrap 按配置懒注册。

## 语言

**Speech Pipeline**:
`@zhin.js/speech` 提供的 STT/TTS 引擎；入站 STT 走 Agent 多模态链，出站 TTS 走 Rich Segment `tts` kind。
_避免使用_：plugin-voice、voice 配置键

**Html Renderer**:
`@zhin.js/html-renderer` 将 HTML 字符串渲染为 PNG/SVG；Rich Segment `html`/`markdown` 的 image mode 依赖它。
_避免使用_：plugin-html-renderer、出站前手写转图

**Scaffold Wizard**:
`@zhin.js/scaffold-wizard` — `zhin setup`、`create-zhin-app` 共用的配置向导与依赖诊断。
_避免使用_：CLI 内嵌重复逻辑

**Optional Peer Diagnosis**:
根据 `zhin.config` 推断是否应安装 speech / html-renderer，供 `zhin doctor` 与 L4 升级使用。
_避免使用_：手动查 package.json

**Satori HTML**:
`@zhin.js/satori` 的 `html()` / `h()` 模板与卡片组件；产出 HTML 字符串，不直接发送。
_避免使用_：与 zhin.js JSX 插件组件混用

## 关系

- **Speech Pipeline** 经 `registerRichSegmentCapabilityLoader('speech')` 注入 Rich Segment 渲染上下文；未安装时 `TtsSegment` 降级 `text`。
- **Html Renderer** 同理注册 `html-renderer` loader；`registerAiTextAsImageOutput` 另挂 `before.sendMessage` 做 AI 纯文本转图。
- **Scaffold Wizard** 的 `diagnoseOptionalPeers` 读取 `speech:`、`htmlRenderer:`、`ai.multimodal.audio.strategy` 与 adapter context 列表。
- **Satori HTML** 输出交给 **Html Renderer** 或业务自行 `render()`；不绕过 `Adapter.sendMessage`。

## 包地图

| 包 | 路径 | 导出契约 |
|----|------|----------|
| speech | `packages/toolkit/speech/` | `createSpeechPipeline` |
| html-renderer | `packages/toolkit/html-renderer/` | `createHtmlRenderer` |
| scaffold-wizard | `packages/toolkit/scaffold-wizard/` | `diagnoseOptionalPeers`, `apply` |
| create-zhin | `packages/toolkit/create-zhin/` | 新建 workspace 文件树 |
| satori | `packages/toolkit/satori/` | `html`, `h`, 卡片组件 |

## 示例对话

> **开发者：** “配置了 `speech:` 还要写 `plugins: - voice` 吗？”  
> **领域专家：** “不需要。`@zhin.js/speech` 是 optional peer；`zhin start` 在检测到包已安装时通过 setup 注册 capability，不是传统 plugins 列表项。”

## 已标记歧义

- `voice:` 配置键已废弃，SSOT 为 `speech:`（ADR 0020）。
- `aiTextAsImage` 在 `before.sendMessage` 执行，晚于 `resolveRichSegments`；与 Rich Segment html 转图是不同路径。
