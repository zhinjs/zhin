# @zhin.js/components

可选的纯函数 JSX 样式组件，适合消息卡片、状态报告与数据摘要。只依赖 `@zhin.js/jsx`，无需 React、截图引擎或 IM Runtime。

```bash
pnpm add @zhin.js/components
```

在 Zhin 项目中配置 `jsx: "react-jsx"`、`jsxImportSource: "zhin.js"`，即可在命令、中间件或注册组件中直接返回 JSX。独立使用时安装 `@zhin.js/jsx` 和 `@zhin.js/components`，把 `jsxImportSource` 设为 `@zhin.js/jsx`，通过它的 `renderToHtml` 输出 HTML。

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
        <Row gap={10}>
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

| 字段               | 用途                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| `palette`          | 画布、卡片、表面、正文与辅助文字、边框、进度条与图表色、阴影；背景值支持 CSS 渐变 |
| `typography`       | 字体、六级字号、字重与无单位行高，字号变大时行高随之增长                          |
| `radii` / `border` | 卡片、表面、进度条与图表圆角；统一边框宽度与样式                                  |
| `spacing`          | 画布与卡片内边距、分区与行间距；`scale` 按比例调整组件内置的 px 间距              |
| `layout`           | 卡片宽度、标签列宽、进度条高度与图表默认尺寸                                      |
| `text`             | 缺失值、空状态、排名分隔符、引用符号、编号前缀、理由分隔符与图表刻度              |
| `style`            | 所有组件根节点的基础 CSS                                                          |
| `components`       | 按组件名配置根节点样式，如 `Card`、`Badge`、`RadarChart`                          |

每个组件都支持 `custom.style` 和 `custom.text`。`custom.style` 接受 CSS 对象或 CSS 声明字符串；对象形式便于类型检查。样式优先级为 `theme.style` → 组件默认样式 → `theme.components[组件名]` → `custom.style`。复合组件也把覆盖应用到实际视觉根节点。局部样式保留原值，不受 `spacing.scale` 缩放。嵌套主题的 `style` 与同名 `components` 配置按 CSS 属性合并。

`custom.text` 按展示入参名称覆盖，例如 `title`、`subtitle`、`value`、`badge`、`message`。这些值和 `theme.text` 都使用 `JSXRenderable`，可以放 JSX、数组、异步节点、数字 `0` 或 `null`。标题、标签、数值、徽章与说明等普通展示入参也是 `JSXRenderable`，对应常见的 ReactNode 用法，无需 React；颜色、尺寸、百分比和图表计算值仍使用明确的字符串或数字类型。自定义组件的展示入参也建议使用 `JSXRenderable`；异步函数的返回值可以标注 `Promise<JSXNode>`，调用结果能够直接传给这些插槽。

## 组件

| 类别 | 组件                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 布局 | `CardCanvas`、`Card`、`Surface`、`Row`、`Col`、`Section`、`Divider`、`DualSection`                       |
| 数据 | `CardHeader`、`Badge`、`KvRow`、`KvTable`、`UsageBar`、`MetricBlock`、`StatChip`、`BarRow`、`EmptyState` |
| 图表 | `BarChart`、`RadarChart`、`Sparkline`                                                                    |
| 内容 | `TopicItem`、`QuoteCard`、`ProfileRow`                                                                   |

`composeCard(children, canvas)` 组合默认画布与卡片。`DEFAULT_CARD_THEME` 提供颜色与阴影 tokens，供自定义报告共享配色；完整主题通过 `DEFAULT_THEME` 与 `ThemeProvider` 配置。所有组件无内部状态、不读取资源、不执行浏览器交互逻辑；使用内联 CSS 和 SVG。浏览器与截图引擎的 CSS 支持范围不同，例如复杂渐变、滤镜或字体能否使用，以最终渲染引擎为准。

## 间距规则

默认间距采用 4px 刻度：`spacing.xs = 4`、`sm = 8`、`md = 12`、`lg = 16`、`xl = 24`。每个刻度可在主题中覆盖，`spacing.scale` 对组件默认间距统一缩放。

容器与内容之间用 padding，元素之间用 margin。默认值始终保持上下相等、左右相等，以 `padding: v h` 或 `margin: v h` 表达；例如画布默认 `16px`、卡片默认 `24px`、Surface 默认 `8px 12px`。CardHeader 的外距为 `8px 0`，Section 与 DualSection 的外距为 `8px 0`、内距为 `16px 0`，KvRow 与 MetricBlock 的外距为 `4px 0`，Divider 明确使用 `16px 0`。

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
