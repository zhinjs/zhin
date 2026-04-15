# @zhin.js/plugin-html-renderer

使用 [@zhin.js/satori](https://github.com/zhinjs/zhin/tree/main/packages/satori) 将 HTML/CSS 渲染为图片的 Zhin.js 插件。

## 特点

- 🚀 **基于 JSDOM** - 直接解析 HTML/CSS，无需 React
- 🎨 **CSS 支持** - 支持 Flexbox、渐变、阴影等常用 CSS 属性
- ✨ **内置字体** - 包含 Roboto 字体，开箱即用
- 📝 **中文支持** - 支持中文字符渲染
- 🤖 **AI 集成** - 提供 `html.render` 和 `html.card` 工具供 AI 使用

## 安装

```bash
pnpm add @zhin.js/plugin-html-renderer
```

## 使用

### 在配置文件中启用

```yaml
# zhin.config.yml
plugins:
  - "@zhin.js/plugin-html-renderer"
```

### 代码中使用

```typescript
import { useContext } from 'zhin.js';

// 获取渲染服务
const renderer = useContext('html-renderer');

// 渲染 HTML 为 PNG
const result = await renderer.render(`
  <div style="
    display: flex;
    padding: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 12px;
  ">
    Hello, World!
  </div>
`, {
  width: 400,
});

// result.data 是 PNG Buffer
// result.width / result.height 是实际尺寸
```

### AI 工具

插件提供两个 AI 工具：

#### `html.render` - 渲染任意 HTML

```
用户: 帮我画一个红色的方块
AI: 调用 html.render 工具生成图片
```

#### `html.card` - 生成卡片

```
用户: 生成一张蓝色主题的通知卡片，标题是"系统消息"，内容是"服务已更新"
AI: 调用 html.card 工具生成美观的卡片图片
```

## 配置

```yaml
# zhin.config.yml
htmlRenderer:
  defaultWidth: 800           # 默认宽度
  defaultBackgroundColor: "#ffffff"  # 默认背景色
  fontUrls:                   # 自定义字体 URL
    - url: "https://example.com/font.woff2"
      name: "CustomFont"
      weight: 400
```

### 纯文本自动转图片（`aiTextAsImage`）

通过框架的 **`before.sendMessage`**，在消息真正发给用户前，把**仅含纯文本**的内容渲染成一张 PNG，再以图片消息发出。适合希望 AI 长文、公告等以「卡片图」展示的场景。

```yaml
htmlRenderer:
  defaultWidth: 720
  defaultBackgroundColor: "#ffffff"
  # 写 true 等价于 { enabled: true }，使用默认样式
  aiTextAsImage: true
  # 或细调：
  # aiTextAsImage:
  #   enabled: true
  #   onlyAdapters: ["onebot"]   # 仅在这些 adapter（SendOptions.context）上生效，不填则全平台
  #   minLength: 10               # trim 后少于该字数不转图，仍发文字
  #   maxLength: 8000             # 超过不转图（0 表示不限制）
  #   skipIfRich: true            # 正文里含 <image>、CQ: 等则跳过（默认 true）
  #   fontSize: 16
  #   color: "#1a1a1a"
  #   padding: 20
  #   scale: 2                    # PNG 缩放，略增清晰度
  #   fileName: "reply.png"
```

**行为说明：**

- 会转换的是：整段内容为**字符串**或**仅 `text` 片段**、且（可选）未命中富媒体启发规则。
- **不会**转换：已含 `image` / `at` / `face` 等段，或字符串里出现 `<image`、`<video`、`<audio`、`<file`、`CQ:` 等。
- 作用范围是**所有**走 `adapter.sendMessage` / `$reply` 的纯文本，**不限于 AI**；若只希望部分场景转图，可配合 `onlyAdapters`、`minLength`，或关闭本项、改用下方 `html.render` / `html.card` 工具。
- 与 **敏感词**等其它 `before.sendMessage` 插件的**注册顺序**有关：一般建议先加载 `sensitive-filter` 再加载本插件，以便先处理文字再转图。

## API

### `render(html, options)`

将 HTML 渲染为图片。

**参数：**
- `html: string` - HTML 代码
- `options.width?: number` - 宽度（默认 800）
- `options.height?: number` - 高度（自动计算）
- `options.format?: 'png' | 'svg'` - 输出格式（默认 png）
- `options.backgroundColor?: string` - 背景色（默认 #ffffff）
- `options.scale?: number` - 缩放比例（默认 1）

**返回：**
```typescript
interface RenderResult {
  data: Buffer | string;  // PNG Buffer 或 SVG 字符串
  format: 'png' | 'svg';
  width: number;
  height: number;
  mimeType: string;
}
```

### `registerFont(font)`

注册自定义字体。

```typescript
renderer.registerFont({
  name: 'MyFont',
  data: fontArrayBuffer,
  weight: 400,
  style: 'normal',
});
```

## 支持的 CSS 属性

参考 [@zhin.js/satori 文档](https://github.com/zhinjs/zhin/tree/main/packages/satori)

主要支持：
- **布局**: `display: flex`, `position`
- **Flexbox**: `flex-direction`, `justify-content`, `align-items`, `gap`
- **尺寸**: `width`, `height`, `padding`, `margin`
- **边框**: `border`, `border-radius`
- **背景**: `background`, `background-image` (渐变)
- **文字**: `font-size`, `font-weight`, `color`, `text-align`
- **变换**: `transform`, `opacity`

## 许可证

MIT
