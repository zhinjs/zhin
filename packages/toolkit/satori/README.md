# @zhin.js/satori

## 这不是什么（避免装错包）

| 包 | 用途 |
|----|------|
| **本包 `@zhin.js/satori`** | [Vercel satori](https://github.com/vercel/satori) 的 **SVG 渲染**：把 React 元素或 HTML 字符串画成 SVG，可选内置中文字体。 |
| **`@zhin.js/adapter-satori`** | [Satori **聊天协议**](https://satori.chat/zh-CN/introduction.html) 的 **IM 适配器**（连 Satori SDK、收消息）。见 [适配器 README](https://github.com/zhinjs/zhin/tree/master/plugins/adapters/satori)。 |

普通聊天机器人 **不需要** 安装本包；只有插件里要 **生成卡片图 / 将 HTML 转 SVG** 时再装。在 Zhin 文档中见 [术语表 - @zhin.js/satori](https://zhin.js.org/reference/glossary.html#包与生态)（或仓库 `docs/reference/glossary.md`）。

---

基于 [官方 satori](https://github.com/vercel/satori) 的薄封装：直接依赖 `satori`；通过 **html-react-parser** 解析 HTML（**需同时安装 `react`**，与 html-react-parser 的 peer 要求一致），再交给 satori 渲染；对外提供**内置字体**。

## 特性

- **直接使用官方 satori**：渲染与布局由 [Vercel satori](https://github.com/vercel/satori) 完成
- **HTML 字符串输入**：`htmlToSvg(html, options)` 使用 `html-react-parser` + `react` 解析后转为 satori 可用的元素树
- **内置字体**：从包内 `fonts/` 目录提供 Noto Sans SC/JP/KR 等，与 satori 的 `fonts` 选项兼容

## 安装

```bash
pnpm add @zhin.js/satori
```

## 用法

### 1. 使用官方 satori（React 元素）

```ts
import satori, { getDefaultFonts } from '@zhin.js/satori'

const fonts = getDefaultFonts()
const svg = await satori(
  {
    type: 'div',
    props: {
      style: { color: 'black', padding: 20 },
      children: 'Hello, World!',
    },
  },
  { width: 600, height: 400, fonts }
)
```

### 2. HTML 字符串 → SVG（htmlToSvg）

```ts
import { htmlToSvg, getAllBuiltinFonts } from '@zhin.js/satori'

const html = `
  <div style="color: black; padding: 20px; background: #f0f0f0;">
    Hello, World!
  </div>
`
const fonts = getAllBuiltinFonts()
const svg = await htmlToSvg(html, {
  width: 600,
  height: 400,
  fonts,
})
```

内联 `style` 会被解析为对象并传给 satori；支持的 HTML/CSS 以 [官方 satori 文档](https://github.com/vercel/satori) 为准。

### 3. 卡片组件（`h()` 或 JSX）

出图卡片可用 **`.ts` + `h()`**，或与 IM 的 zhin.js JSX **分离** 的 **Satori JSX**（同步产出 HTML 字符串）。

#### 3a. `h()`（无 JSX 编译）

```ts
import { h, Card, CardHeader, StatChip, Row, wrapCardHtml } from '@zhin.js/satori'

const fragment = [
  h(Card, { children: [
    h(CardHeader, { title: '今日本群消息统计' }),
    h(Row, { children: h(StatChip, { label: '消息', value: '120' }) }),
  ].join('') }),
].join('')

const html = wrapCardHtml(fragment, '#d8dce3')
```

#### 3b. JSX（`jsxImportSource: "@zhin.js/satori"`）

与 `zhin.js` 相同：在 **tsconfig** 或 **文件顶注释** 指定 import source，TypeScript 会拉取 `@zhin.js/satori/jsx-runtime`。

`tsconfig.json`（插件卡片目录）：

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@zhin.js/satori"
  }
}
```

单文件覆盖（与 IM 组件同仓库时推荐，避免和 `zhin.js` 混用）：

```tsx
/** @jsxImportSource @zhin.js/satori */
import { Card, CardHeader, StatChip, Row, wrapCardHtml } from '@zhin.js/satori'

export function buildStatsCard() {
  const body = (
    <Card>
      <CardHeader title="今日本群消息统计" />
      <Row>
        <StatChip label="消息" value="120" />
      </Row>
    </Card>
  )
  return wrapCardHtml(body, '#d8dce3')
}
```

| 运行时 | 包路径 | 产出 |
|--------|--------|------|
| IM 消息 | `zhin.js` / `@zhin.js/core` | `MessageComponent`（异步 `renderJSX`） |
| Satori 卡片 | `@zhin.js/satori` | **HTML 字符串**（同步） |

内置组件包括 `Card`、`Surface`、`Section`、`KvTable`、`UsageBar`、`StatChip` 等。产出 HTML 后：

- 测试：直接 `htmlToSvg(wrapCardHtml(...))`
- IM 出站：`segment.html({ html })` + 可选 `@zhin.js/html-renderer` 自动转 PNG

### 4. 内置字体

从包内 `fonts/` 读取，与 satori 的 `fonts` 选项格式一致：

| 方法 | 说明 |
|------|------|
| `getNotoSansSC()` | Noto Sans 简体中文 |
| `getNotoSansJP()` | Noto Sans 日文 |
| `getNotoSansKR()` | Noto Sans 韩文 |
| `getAllBuiltinFonts()` | 当前包内所有可用字体 |
| `getDefaultFonts()` | 默认集合（如 Poppins，若存在） |
| `getExtendedFonts()` | 默认 + Noto Sans SC |
| `getCJKFonts()` | 仅 CJK |
| `getCompleteFonts()` | 推荐完整集合 |

未包含在包内的字体文件（如 Poppins、Noto Color Emoji）会返回 `null`，可自行下载后通过 `fonts` 传入。

## API

- **`satori(element, options)`**：官方 satori，签名与 [satori](https://www.npmjs.com/package/satori) 一致
- **`htmlToSvg(html, options)`**：HTML 字符串 → SVG；`options` 同 satori（`width`、`height`、`fonts` 等）
- **`@zhin.js/satori/jsx-runtime`**、**`@zhin.js/satori/jsx-dev-runtime`**：automatic JSX 运行时（`jsx` / `jsxs` / `Fragment` / `renderJSX`）
- **字体方法**：见上表

## 环境

- Node.js >= 18
- 依赖：`satori`、`html-react-parser`、`react`（^18 或 ^19，与 html-react-parser 兼容）

## 许可证

MPL-2.0
