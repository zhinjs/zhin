---
sidebar: false
---

# JSX、组件与 HTML 出站重整计划

状态：契约已确认，进入分步实施。2026-10-09 基于 `codex/stability-console-acceptance` / `b8c0f46c7` 的审计；实现分支 `feat/jsx-html-components`。三个 Agent 分别审计公共契约、返回值链路和平台策略；中间件语义、样式包名和旧入口直接移除均已由用户确认。

## 目标与已确认行为

- `zhin.js/jsx` 对外提供统一 JSX 能力，指令 `execute`、入站中间件 `handle`、注册组件 `render` 均可直接返回 JSX。
- JSX 先生成 HTML，再生成 `segment.html`；平台策略决定保留 HTML、渲染图片或降级文本。
- `zhin.js/component` 提供组件定义、发现与调用能力；样式组件放在独立可选包 `@zhin.js/components`。
- 入站链结果向外传递，链结束后自动回复一次；显式 `$reply` 仍可多次发送。
- 出站中间件保留 `next()` 的放行控制，通过 `envelope.replace(JSX)` 改写，不引入返回值自动发送。

完成标准是三种作者入口进入同一条真实发送链路，类型与实际值一致。只有 HTML serializer 的测试通过不代表完成。

## 实施前的问题与依据

| 问题 | 当前代码 |
| --- | --- |
| Core JSX 返回 `{type,data}`，原生标签丢失标签与属性；与 Segment 外形冲突 | [`core/jsx.ts`](../../packages/im/core/src/jsx.ts)、[`contracts.ts`](../../packages/im/core/src/plugin-runtime/im/contracts.ts) |
| Satori JSX 返回普通字符串；嵌套标签被当作文本再次转义 | [`satori/jsx.ts`](https://github.com/zhinjs/zhin/blob/b8c0f46c7/packages/toolkit/satori/src/jsx.ts) |
| html-renderer 又有独立 `{type,props}` serializer，未覆盖函数与异步组件 | [`html-renderer/jsx.ts`](https://github.com/zhinjs/zhin/blob/b8c0f46c7/packages/toolkit/html-renderer/src/jsx.ts) |
| 实际 OutboundRenderer 不消费现有 JSX；旧 JSX 发送测试调用的是旧 helper | [`outbound-renderer.ts`](../../packages/im/core/src/plugin-runtime/im/outbound-renderer.ts)、[`jsx-send-pipeline.test.ts`](https://github.com/zhinjs/zhin/blob/b8c0f46c7/packages/im/core/tests/jsx-send-pipeline.test.ts) |
| 指令立即自动发送结果；中间件只返回 void，并丢弃返回值 | [`message-dispatcher.ts`](../../packages/im/core/src/plugin-runtime/im/message-dispatcher.ts)、[`middleware-index.ts`](../../packages/im/middleware/src/middleware-index.ts) |
| 根入口旧函数式 defineComponent 与子路径对象式 defineComponent 同名异义 | [`core/component.ts`](https://github.com/zhinjs/zhin/blob/b8c0f46c7/packages/im/core/src/component.ts)、[`component/definition.ts`](../../packages/im/component/src/definition.ts) |
| Adapter 已声明 `html: direct/image/text`，实际仍仅按 Sandbox 包名判断 direct | [`adapter/definition.ts`](../../packages/im/adapter/src/definition.ts)、[`outbound-delivery-runtime.ts`](../../packages/im/core/src/plugin-runtime/im/outbound-delivery-runtime.ts) |
| SendContent 数组允许嵌套，但后续平台归一化没有完整扁平化 | [`outbound-renderer.ts`](../../packages/im/core/src/plugin-runtime/im/outbound-renderer.ts)、[`outbound-segments.ts`](../../packages/im/core/src/plugin-runtime/im/outbound-segments.ts) |
| 官方插件指引禁止服务端 TSX，Component README 也与实际 TSX loader 矛盾 | [插件指引](../../.github/instructions/zhin-plugin.instructions.md)、[Component README](../../packages/im/component/README.md) |

当前真实链路是 `RuntimeMessage reply → OutboundDeliveryRuntime → OutboundRenderer → 出站 middleware → AdapterIndex.send → Endpoint.send`。`before.sendMessage` 目前只有 MessageBus 声明，计划和验收不把它当成已经触发的运行时事件；本次采用真实出站中间件作为拦截点，清理相关失真说明。

## 目标模块分工

| 入口 / 包 | 负责什么 | 依赖限制 |
| --- | --- | --- |
| 新增 `@zhin.js/jsx`，目录 `packages/im/jsx` | branded JSX tree、JSX 类型、factory、Fragment、唯一异步 HTML serializer | 零运行时依赖，无 IM、平台、React、截图引擎 |
| `zhin.js/jsx` | 公开上述 JSX 创作面与 `renderToHtml` | 门面，不再另写 renderer |
| `zhin.js/jsx-runtime` / `jsx-dev-runtime` | automatic JSX 编译技术入口，委托同一实现 | 与显式入口具有完全相同语义 |
| `zhin.js/component` | 唯一对象式 `defineComponent({render})`、组件调用 `component(name,props)`、相关类型 | 注册组件由 ComponentIndex 解析当前 snapshot/requester/owner |
| 新增 `@zhin.js/components`，目录 `packages/toolkit/components` | Card、布局、主题、指标与图表等纯 JSX 函数组件 | 仅依赖 JSX 基础包，可选安装 |
| Core 出站模块 | JSX → HTML → canonical HTML Segment；统一 SendContent 校验、顺序、平台协商与投递 | 不直接依赖组件库、Satori、Shotium |
| `@zhin.js/html-renderer` | HTML → PNG/JPEG | 不拥有 JSX/组件定义或第二套 serializer |
| `@zhin.js/satori` | HTML/CSS → SVG、字体能力 | 不拥有样式组件和第二套 JSX runtime |
| CLI | 可选 renderer 的加载和 generation-owned Resource 装配 | 沿用唯一 composition root |

```mermaid
flowchart LR
  J["JSX 基础包：tree / types / HTML serializer"] --> F["zhin.js/jsx 门面"]
  J --> C["@zhin.js/components 可选样式包"]
  J --> O["Core 出站归一化"]
  A["execute / inbound handle / component render / $reply"] --> O
  O --> H["segment.html"]
  H --> P["Adapter HTML policy"]
  P --> D["direct：原生 HTML"]
  P --> I["image：可选 renderer → canonical image"]
  P --> T["text：明确 fallback"]
  D & I & T --> E["统一出站 middleware / 最终校验 / Endpoint"]
```

上图是职责图，实际执行须保留现有出站中间件能检查最终候选 payload 的能力：第一次归一化建立 envelope，替换内容再通过同一归一入口校验；相同 JSX 根不得重复求值。

Feature 的 TResult 保持传输中立，IM 组装层负责校验是否可发送；Command 的通用业务返回能力不强制改成 HTML。新增基础包、组件包必须登记到架构与依赖门禁，不能借未映射的目录绕过检查。

## JSX 与 SendContent 契约

1. JSX.Element 精确对应带独立 brand 的 lazy tree，不是 HTML string，也不借用 Segment 的 `{type,data}`。JSX.ElementType 单独描述 intrinsic、同步/异步函数组件和 Fragment，确保 TypeScript 能接受异步 JSX 函数组件。
2. 普通字符串继续表示文本；`'<b>x</b>'` 不自动解释成 HTML。纯函数组件不需要 defineComponent 注册。
3. 嵌套 JSX、函数返回的 JSX、异步子树和数组递归求值；`null/undefined/boolean` 为空，数字保留，包括 `0`；Fragment 不增加 DOM 包装。
4. 文本和属性默认转义。className、style 对象、HTML/SVG 属性与 void 元素形成明确类型和序列化规则；不声称支持浏览器事件处理器或 React hooks。Raw HTML 只允许显式入口。
5. JSX 子树输出一个 HTML 段；外部 SendContent 的数组则扁平化并保留 text、HTML、mention、image、keyboard 的顺序。JSX 中不隐式塞入平台 Segment；混合消息写在 SendContent 数组中。
6. 统一根入口、runtime 与 `$reply` 的 SendContent，消除旧 MessageComponent 类型与实际 runtime 类型双轨。各入口无需 `as SendContent` 即可使用 JSX。
7. `renderToHtml` 只序列化，不发送、不截图。直接返回 JSX 采用已有渲染默认值；需自定义宽度、文件名、明确文本 fallback 时仍使用 `segment.html({html: await renderToHtml(node), ...})`。第一版不引入特殊标签偷偷改变发布或平台策略。
8. renderer 使用当前 operation snapshot；函数组件不读取模块级最新 generation。注册组件的资源上下文只由 ComponentIndex 提供，普通纯函数 JSX 不伪造 CapabilityContext。
9. JSX 求值失败进入明确的投递失败与内部诊断，不将异常堆栈或错误文本伪装成正常聊天内容。空 Fragment 与 void 在结果类型上区分，最终空内容不调用 Endpoint。
10. `${...}` 旧文本模板解析不再对生成的 HTML 或 JSX 文本二次执行。

默认保留 `jsxImportSource: "zhin.js"`，编译器解析现有技术子路径；作者显式导入 JSX 能力使用 `zhin.js/jsx`。若确定要把 `jsxImportSource` 也设为 `zhin.js/jsx`，须增加 `./jsx/jsx-runtime` 与 `./jsx/jsx-dev-runtime` 导出；这属于同一实现的编译入口，不能误写成一套新 runtime。

```tsx
import { defineCommand } from 'zhin.js/command';
import { Card, Row, Badge } from '@zhin.js/components';

export default defineCommand({
  execute: () => (
    <Card>
      <h2>服务状态</h2>
      <Row><Badge>在线</Badge><span>运行正常</span></Row>
    </Card>
  ),
});
```

注册组件仍是对象式定义，其 `render` 直接返回同样的 JSX；通过 `component('status-card', props)` 调用时，名字查找、override 和资源读取继续归当前 generation 的 ComponentIndex。不再用另一套同名函数式 defineComponent 解释 JSX 函数。

## 入站中间件结果：已确认

| 写法 | 行为 | 自动回复内容 owner |
| --- | --- | --- |
| `return <Card />` | 停止后续链，形成待回复结果 | 当前 middleware |
| `return next()` | 透传下游结果 | 保留下游 owner |
| `await next(); return <Card />` | 用新内容替换下游待自动回复结果 | 当前 middleware |
| `await next()`，无 return | 继续透传下游结果 | 保留下游 owner |
| 不 next、无返回 | 消费输入，无自动回复 | 无 |
| 显式 `$reply(A)` 后返回 JSX | 显式消息立即发送，链结束再自动发送 JSX | 分别按各自调用者 |

实现使用一个很小的 continuation 类型：`next()` 返回只用于透传的不透明结果，普通作者仍只需 `return next()`。内部 frame 保存完整下游 outcome，区分路由事实和待发送内容；当前 frame 的 carrier 身份保留 owner，返回新内容属于当前 middleware。绝不通过“返回值与下游内容相等”判断 owner。

CommandDispatcher 停止立即自动回复，只返回匹配事实与待回复内容；最外层 InboundRuntime 在租约关闭前执行最终 `$replyFrom(owner, content)`。匹配命令返回 void 仍是 matched；没有内容不等于 miss，不会因此启动 AI。

当前 AI/interaction 使用显式回复且可能发送多条消息，它们的 outcome 是 handled、没有待自动回复内容，避免重复发送。上游替换只作用于尚未自动发送的返回值，不能撤销已经发生的显式回复。交互输入 claim 的独占规则保留。

防护包括 next 单次调用、跨 frame/operation/generation 的 carrier 拒绝、未 await 的下游 Promise 在 scope 结束前结算、异常不被丢弃。出站 middleware 单独保留 void/replace/next 类型，入站 carrier 不进入出站链。

## 平台策略与降级

| Adapter 声明 | HTML 段处理 | 验收对象 |
| --- | --- | --- |
| `html: direct` | 保留 HTML，平台 codec 消费；其他段继续归一化与支持类型校验 | Sandbox、Email |
| `html: image` | 可用 renderer 生成 PNG，进入 canonical image / MediaRef 与平台媒体投递 | ICQQ、OneBot、Telegram、Slack |
| `html: text` | 明确 fallback 优先，否则提取 HTML 文本；不调用 renderer | 纯文本端点 |
| 未声明 | 继续保守 image-or-text 默认策略 | 自定义适配器 |
| 只接受 URL、没有二进制投递方式 | 跳过无意义的截图，转文本 | GitHub、LINE、对应钉钉模式 |

按 endpoint 对应的当前 Adapter definition 解析策略，支持 1:N 展开的 endpoint，不再判断供应商包名。direct 只跳过 HTML 转换，不能跳过其他媒体/交互/支持类型校验。

没有 renderer 或截图失败可在尚未投递前转文本，同时记录结构化原因；诊断不记录完整 HTML。平台上传/发送已经尝试后失败或结果未知，保留 failed/unknown receipt，不擅自再发文本造成重复。HTML 中的按钮只是展示，原生交互仍使用 canonical keyboard。

## 分步交付与多 Agent 分工

使用新 issue 分支与一个集成 PR，分步形成可审查提交；不在 main 提交。包契约冻结后再并行实现，基础运行时和样式包在同一次受控发版中切换，避免用户装到半套新语义。

| 阶段 | 工作与验收 | 责任 |
| --- | --- | --- |
| P0：冻结契约 | 本计划、包名、导出、JSX tree、入站/出站语义；补实际调用链清单 | 主 Agent；公共契约与链路 Agent 复核 |
| P1：唯一 JSX 模块 | branded tree、HTML serializer、类型 fixture、automatic runtime exports；架构门禁 | JSX Agent；先冻结交接类型 |
| P2：真实发送链 | canonical SendContent、OutboundRenderer、数组展开、Adapter html policy、replace(JSX)；真实 Runtime 测试 | IM Agent；与 P1 接口串行联调 |
| P3：结果传递 | middleware target 类型、continuation、command 延迟自动回复、owner/lease/AI/interaction 回归 | IM Agent；同一批核心文件不让多个 Agent 同时改 |
| P4：样式与工具收敛 | 提取 Card/布局/主题/指标/图表；Satori 与 html-renderer 只消费 HTML；全仓库消费者切换 | Components Agent，可与 P2/P3 并行改自己的目录 |
| P5：用户路径与收尾 | minimal-bot、脚手架、tsx loader/HMR、预览、双语文档、skill/AGENTS、changesets、包产物验证 | 主 Agent 负责集成；独立审查 Agent 复核最终 diff |

实现期间最多三条主工作线：JSX 基础、IM 链路、组件与消费者。每条线明确目录所有权；核心类型冻结前不让下游猜接口。最终审查须有人专门检查越层依赖、owner、generation、重复发送和降级后误报。

P4 的统一定制面：ThemeProvider 以 JSX 树作用域传递共享背景、色彩、字体、间距、圆角、边框、阴影与默认文案；组件 `custom.style` 提供局部覆盖，展示位使用 JSXRenderable。异步／嵌套／并行主题不得串色或读取模块级 current theme。

间距使用统一 4px 基准刻度：组件间的外距优先 margin，容器与内容的内距用 padding；默认上下同值、左右同值，Divider 也使用对称外距，避免父 gap 与子 margin 重复。普通 block 文档流可折叠纵向相邻 margin；图片渲染所需的 Flex 布局不承诺折叠，横向与换行布局保留 gap。局部自定义 CSS 仍允许按业务需要覆盖。

P4 的第一批稳定组件：CardCanvas/Card、Row/Col、Section/Divider、Badge、KvTable、MetricBlock、UsageBar 和主题 tokens；现有图表单独形成可审查提交并迁移消费者，不借此次重整扩大新组件功能清单。

## 验收矩阵

- **类型与包产物**：公开源码与已构建 npm 产物均能编译 execute、inbound handle、component render、`$reply(JSX)`；development/prod exports 一致；JSX.Element 与运行时 brand 一致；异步函数组件可作为标签。
- **HTML 语义**：nested intrinsic、异步函数返回 JSX、Fragment、数组、false/null/undefined/0、Unicode、文本/属性/style 转义、显式 Raw、HTML/SVG、void 元素、循环/过深树失败。
- **实际入口**：通过真实 ImRuntime 的命令、中间件和注册组件各返回同一 JSX，送到测试 Endpoint 的 payload 一致；组件只执行一次，替换内容再走归一化；混合段保持顺序。
- **入站语义**：四种 next 写法、两层/三层回卷、同值新内容 owner 更新、void matched、短路、跨 frame carrier、next 重复、显式多次回复加一次自动结果、AI/interaction 不重复发送。
- **平台能力**：direct/image/text、缺 renderer、renderer 异常、URL-only、展开 endpoint、未支持 Segment；direct 不使其他段绕过审核；上传失败/未知状态不重发文本。
- **运行时**：组件 await 期间 HMR 后仍使用原 snapshot；多 Root 不互串；CLI 开发 TSX 与编译后的生产启动均能跑；Console 预览通过真实 render/send 路径。
- **用户黄金路径**：minimal-bot 的 `.tsx` execute/middleware/component 示例、脚手架新建与 `.tsx` HMR；无截图引擎时文本结果可读，安装可选引擎后图片结果可用。
- **架构与发布**：architecture/dependency/harness-paths、相关类型检查与 lint、IM 安装体积预算、组件包不拉入 React/截图引擎、文档链接、changeset 和 pack 后导出；全局门禁按最终改动范围运行。

确定性测试使用测试 Endpoint 和可控 renderer；实际平台图片上传另做专门账号验收，不能以 mock 通过宣称所有平台可用。

## 旧入口的处置：已确认

直接删除旧 MessageComponent JSX、旧函数式 defineComponent/模板组件 helper、Satori JSX/string 样式组件导入、html-renderer 独立 JSX serializer。清理所有仓库消费者、测试与导出，不保留双 runtime 或迁移入口。

用户已确认包名及旧入口直接移除。实施按 P1–P5 推进，测试与实际完成情况在 PR 中记录；不自动合并或发布。
