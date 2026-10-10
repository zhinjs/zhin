# @zhin.js/components

可选的纯函数 JSX 样式组件，适合消息卡片、状态报告与数据摘要。使用 `@zhin.js/jsx` 构建节点，`entities`、`marked`、`shiki` 等文档解析与代码着色依赖随包提供；无需 React、截图引擎或 IM Runtime。

```bash
pnpm add @zhin.js/components
```

在 Zhin 项目中配置 `jsx: "react-jsx"`、`jsxImportSource: "zhin.js"`，即可在命令、中间件或注册组件中直接返回 JSX。独立使用时安装 `@zhin.js/jsx` 和 `@zhin.js/components`，把 `jsxImportSource` 设为 `@zhin.js/jsx`，通过它的 `renderToHtml` 输出 HTML。

服务端 TSX 支持只负责 JSX 转译，不包含样式构建。**不支持直接 `import './card.css'`、CSS Modules 或 CSS 的 `?raw` 导入**，也不提供 Sass/SCSS、Less、Stylus、PostCSS 等预处理或生成流程。原生 JSX 标签使用内联 `style`（CSS 对象或声明字符串）；样式组件使用 `ThemeProvider` 和 `custom.style`。浏览器 Console 页面走独立构建链路，不属于此服务端 TSX 承诺。

```tsx
import {
  Badge,
  CardCanvas,
  Card,
  CardHeader,
  Row,
  StatChip,
} from "@zhin.js/components";

export function StatusCard() {
  return (
    <CardCanvas>
      <Card>
        <CardHeader
          title={<strong>服务状态</strong>}
          subtitle="最近一次检查"
          badge={<Badge>在线</Badge>}
        />
        <Row gap={16}>
          <StatChip label="请求数" value={0} />
        </Row>
      </Card>
    </CardCanvas>
  );
}
```

组件返回惰性 JSX 树，文本统一转义；普通字符串即使包含 HTML 标签也会显示为文本。需要 HTML 字符串时调用 `await renderToHtml(node)`。Zhin 出站通过 `$reply` 或 Adapter 的统一链路，由平台能力决定最终发送 HTML、图片还是文本。图表仅用于展示，不提供平台按钮或点击事件。

## 统一主题与局部调整

`DEFAULT_THEME` 提供默认浅色卡片与柔和阴影。`ThemeProvider` 接受部分主题配置，嵌套 Provider 继承父主题未覆盖的字段。主题只作用于自己的 JSX 子树；异步组件产生的新组件也会继承，多个并行渲染之间彼此隔离。

```tsx
import {
  ThemeProvider,
  CardCanvas,
  Card,
  CardHeader,
  EmptyState,
} from "@zhin.js/components";

const card = (
  <ThemeProvider
    theme={{
      palette: {
        canvas: "linear-gradient(135deg, #e0e7ff, #f0fdfa)",
        card: "#ffffff",
        text: "#172554",
        shadowLg: "0 12px 32px rgba(30, 64, 175, 0.12)",
      },
      typography: {
        fontFamily: "sans-serif",
        sizes: { title: 24, body: 14 },
        lineHeight: 1.5,
      },
      radii: { card: 20 },
      border: { width: 1, style: "solid" },
      spacing: { cardPadding: "24px", sectionGap: 8 },
      components: { Card: { borderColor: "#c7d2fe" } },
      text: { emptyState: <em>暂时没有记录</em> },
    }}
  >
    <CardCanvas>
      <Card custom={{ style: { borderRadius: 28, padding: 30 } }}>
        <CardHeader
          title="发布情况"
          custom={{ text: { subtitle: <span>今日更新</span> } }}
        />
        <EmptyState />
      </Card>
    </CardCanvas>
  </ThemeProvider>
);
```

主题可调整的字段：

| 字段               | 用途                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `palette`          | 画布、卡片、表面、正文与辅助文字、边框、进度条与图表色、阴影；背景值支持 CSS 渐变                     |
| `typography`       | 字体、六级字号、字重与无单位行高，字号变大时行高随之增长                                              |
| `radii` / `border` | 卡片、表面、进度条与图表圆角；统一边框宽度与样式                                                      |
| `spacing`          | 画布与卡片内边距、分区与行间距；`scale` 按比例调整组件内置的 px 间距                                  |
| `layout`           | 卡片宽度、标签列宽、进度条高度与图表默认尺寸                                                          |
| `text`             | 缺失值、空状态、排名分隔符、引用符号、编号前缀、理由分隔符、列表标记、代码标题（codeTitle）与图表刻度 |
| `code`             | 代码高亮主题、字体与字号，通过 theme.code 配置                                                        |
| `style`            | 所有组件根节点的基础 CSS                                                                              |
| `components`       | 按组件名配置根节点样式，如 `Card`、`Badge`、`RadarChart`                                              |

每个组件都支持 `custom.style`；有对应展示入参的组件还支持 `custom.text`。`custom.style` 接受 CSS 对象或 CSS 声明字符串；对象形式便于类型检查。样式优先级为 `theme.style` → 组件默认样式 → `theme.components[组件名]` → `custom.style`。复合组件也把覆盖应用到实际视觉根节点。局部样式保留原值，不受 `spacing.scale` 缩放。嵌套主题的 `style` 与同名 `components` 配置按 CSS 属性合并。

`Card`、`Row` 等纯容器没有可替换文案，应通过 children 设置内容。`custom.text` 按展示入参名称覆盖，例如 `title`、`subtitle`、`value`、`badge`、`message`。这些值和 `theme.text` 都使用 `JSXRenderable`，可以放 JSX、数组、异步节点、数字 `0` 或 `null`。标题、标签、数值、徽章与说明等普通展示入参也是 `JSXRenderable`，对应常见的 ReactNode 用法，无需 React；颜色、尺寸、百分比和图表计算值仍使用明确的字符串或数字类型。自定义组件的展示入参也建议使用 `JSXRenderable`；异步函数的返回值可以标注 `Promise<JSXNode>`，调用结果能够直接传给这些插槽。

## 组件

| 类别 | 组件                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 布局 | `CardCanvas`、`Card`、`Surface`、`Row`、`Col`、`Section`、`Divider`、`DualSection`                       |
| 数据 | `CardHeader`、`Badge`、`KvRow`、`KvTable`、`UsageBar`、`MetricBlock`、`StatChip`、`BarRow`、`EmptyState` |
| 表格 | `Table`、`TableRow`、`TableCell`                                                                         |
| 控件 | `Checkbox`、`Radio`、`Switch`、`Button`                                                                  |
| 列表 | `List`、`ListItem`                                                                                       |
| 文档 | `Markdown`、`CodeBlock`                                                                                  |
| 图表 | `BarChart`、`RadarChart`、`Sparkline`                                                                    |
| 内容 | `TopicItem`、`QuoteCard`、`ProfileRow`                                                                   |

`composeCard(children, canvas)` 组合默认画布与卡片。`DEFAULT_CARD_THEME` 提供颜色与阴影 tokens，供自定义报告共享配色；完整主题通过 `DEFAULT_THEME` 与 `ThemeProvider` 配置。所有组件无内部状态、不读取资源、不执行浏览器交互逻辑；使用内联 CSS 和 SVG。浏览器与截图引擎的 CSS 支持范围不同，例如复杂渐变、滤镜或字体能否使用，以最终渲染引擎为准。

## 表格与展示控件

简单表格使用 `Table` 的 `caption`、`headers` 和二维 `rows`，这些展示位都支持 JSX。复杂表格组合 `TableRow` 与 `TableCell`；未指定宽度的单元格平分剩余空间，`width` 支持数字或 CSS 长度，`align` 可选 left、center、right。组合首行可设置 `separator={false}`，数据入口自动处理首行边线。表头行与表头单元格分别设置 `header`，单元格可以嵌套 Row、Badge 等组件。

```tsx
<Table
  caption={<strong>服务巡检</strong>}
  headers={["名称", "状态"]}
  rows={[
    ["Gateway", <Badge>在线</Badge>],
    ["Worker", <Badge>等待</Badge>],
  ]}
/>
```

表格通过 Flex 行列渲染，兼容 HTML 和 Satori SVG。Checkbox、Radio、Switch 展示 `checked`/`disabled` 状态；Button 支持 primary、secondary、danger 外观和 sm、md、lg 尺寸。这些控件用于消息卡片与截图里的状态表达，不绑定浏览器事件、不提交表单；平台交互动作仍由对应的交互能力处理。

## 列表、Markdown 与代码

`List` 的 `items` 接受 JSX 内容数组，`ordered` 与 `start` 控制编号。组合式 `children` 中的直接 ListItem（含 Fragment、ThemeProvider 中的项）也会自动编号；未知函数组件保持惰性，不预执行或消耗序号，动态项可改用 `items` 或显式 `marker`。ListItem 支持嵌套列表，`marker` 可以是 JSX、数字、Checkbox，设为 null/false 隐藏标记；`theme.text.listMarker` 和 `custom.text.marker` 可覆盖默认标记。List 容器没有额外外距/gap，每项使用对称外距。

`Markdown` 将文档解析为这些展示组件，支持标题、段落、嵌套列表、任务项、表格、引用与代码；原始 HTML 内容作为文本处理，图片仅显示替代文案，链接仅保留安全协议或相对路径。`source` 或字符串 `children` 是待解析的 Markdown 文本。单篇最长 100,000 字符，最多 10,000 个 token、24 层解析深度；超限会报错，不静默截断。

代码围栏使用 `CodeBlock`，也可直接组合它：

```tsx
<ThemeProvider theme={{ code: { theme: "github-dark", fontSize: 13 } }}>
  <CodeBlock
    source={'const ready = true;\nconsole.log(ready);'}
    language="typescript"
    title={<strong>plugin.ts</strong>}
    lineNumbers
    wrap
  />
</ThemeProvider>
```

`CodeBlock` 提供语言标签、可选 JSX 标题、语法着色与行号；`theme.code` 设置共享配色主题、等宽字体和字号，`themeName` 可单独选择 Shiki 内置主题。默认显示行号并换行；`wrap={false}` 在浏览器中允许横向滚动，静态图片不能滚动，应保留默认换行或选择足够宽的画布。未识别的语言按纯文本展示，代码最长 100,000 字符。`custom.text.title` 和 `theme.text.codeTitle` 可替换标题文案，`custom.style` 覆盖实际根节点；显式覆盖前景色时，代码整体使用该颜色。所有代码 token 都经过 JSX 文本转义，不插入高亮引擎生成的 HTML，也不执行代码。

## 组件画廊

画廊展示所有组件的默认、主题与局部自定义场景，包括表格、Row 排版和控件：

```bash
pnpm --filter @zhin.js/components build
pnpm --filter @zhin.js/components preview -- /private/tmp/zhin-jsx-visual/gallery.html
```

用浏览器打开输出的 HTML。发布包也包含 `examples/gallery.mjs`，可用 Node 生成本地预览。

## 间距规则

默认间距采用 4px 刻度：`spacing.xs = 4`、`sm = 8`、`md = 12`、`lg = 16`、`xl = 24`。每个刻度可在主题中覆盖，`spacing.scale` 对组件默认间距统一缩放。

容器与内容之间用 padding，元素之间用 margin。默认值始终保持上下相等、左右相等，以 `padding: v h` 或 `margin: v h` 表达；例如画布默认 `16px`、卡片默认 `24px`、Surface 默认 `8px 12px`。CardHeader 的外距为 `8px 0`，Section 与 DualSection 的外距为 `8px 0`、内距为 `16px 0`，KvRow、MetricBlock、QuoteCard、EmptyState、TopicItem 与 ProfileRow 的外距为 `4px 0`，Divider 明确使用 `16px 0`。

Surface 是基础容器，默认无外距；Header 内的徽章表面和 StatChip 不会因此带入额外外距。QuoteCard、EmptyState 等独立语义块连续出现时，在默认 Flex 布局中由两侧 `4px` 外距形成 `8px` 间隔。

Row、Col 默认 gap 为 0。表格与分区不再给已有外距的竖向子组件额外叠加 gap；标题与副标题、标签与数值等组件内部的紧密排版，可以用统一刻度的 Row/Col gap，内部元素不再同时设置同一方向的外距。`sectionGap` 可覆盖分区内容的对称外距，`canvasPadding`、`cardPadding` 可覆盖对应容器的内距。调用方设置非零 gap 时，应选择不带相应外距的子元素，或通过 `custom.style` 明确覆盖外距。

浏览器普通 block 文档流中，相邻的纵向 margin 可以自然折叠；Flex/Grid 的子元素 margin 不折叠，会相加。默认组件使用 Flex，保证 Satori 的 HTML→SVG 路径可用，不模拟外边距折叠，也不人为计算相邻外距。需要自然折叠的 HTML 布局，可以使用普通 block 容器：

```tsx
<div style={{ display: "block" }}>
  <div style={{ margin: "16px 0" }}>
    <Card>第一项</Card>
  </div>
  <div style={{ margin: "16px 0" }}>
    <Card>第二项</Card>
  </div>
</div>
```

这两个 block 之间的纵向间距为 16px；改为 Flex column 后为 32px。普通 block 布局适用于原生 HTML 或支持浏览器 CSS 的截图引擎；Satori 对多子节点容器要求 Flex，不能直接沿用此布局。默认规范不限制 `custom.style`：业务需要时仍可以设置非对称 margin/padding。
