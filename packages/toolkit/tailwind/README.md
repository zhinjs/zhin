# @zhin.js/tailwind

将 Tailwind CSS 的静态工具类转换为内联样式，供 Zhin JSX 与样式组件使用。它使用官方 Tailwind 4 编译器，不依赖 Core、浏览器 DOM 或全局样式表。

```sh
pnpm add @zhin.js/tailwind
```

```tsx
import { createTailwindStyle } from "@zhin.js/tailwind";
import { Card, ThemeProvider } from "@zhin.js/components";

const tw = await createTailwindStyle({
  theme: { "--color-brand": "#2563eb", "--spacing": "0.25rem" },
});

const native = (
  <div style={tw("grid grid-cols-2 gap-4 p-6 bg-brand text-white rounded-xl")}>
    Hello
  </div>
);
const card = (
  <Card custom={{ style: tw("p-6 border border-blue-500 rounded-xl") }}>
    Ready
  </Card>
);
const themed = (
  <ThemeProvider theme={{ components: { Card: tw("bg-blue-50 rounded-xl") } }}>
    {card}
  </ThemeProvider>
);
```

`createTailwindStyle(options?)` 返回 Promise，初始化后 `tw(classes)` 同步返回冻结的只读对象。每个工厂拥有独立的主题和缓存；主题值在初始化时固定。`theme` 接受 Tailwind 的 `--color-*`、`--spacing`、`--font-*`、`--radius-*` 等变量，也可供任意值工具类通过 `var()` 引用。内部 `--tw-*` 变量由编译器管理，不能通过配置覆盖。

冲突按照官方生成样式表中的顺序解决，传入字符串的顺序不决定优先级。`tw('p-2 p-4')` 与 `tw('p-4 p-2')` 的结果相同。结果不含未解析的 CSS 变量：工具类变量、主题别名、回退值与 `@property` 默认值会被解析。变量缺失或循环会明确报错。

## 支持范围

以原生 HTML 和 `@pixel.js/shotium` 的静态渲染能力为准。`rem`、`calc()`、百分比、逻辑属性、`oklch()` 与 `color-mix()` 保留为浏览器 CSS 值，沿用渲染器实际根字号与布局环境。本包不提供 Satori 兼容保证。

| 范围             | 示例                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| 布局与尺寸       | `flex flex-col items-center justify-between`, `grid grid-cols-2`, `w-1/2 w-[240px]` |
| 间距与逻辑方向   | `gap-4 p-6 px-4 mb-2 ms-2`                                                          |
| 字体与文字       | `font-sans font-bold text-xl leading-tight text-center truncate`                    |
| 颜色、透明度     | `bg-blue-500 text-white bg-blue-500/50 opacity-75`                                  |
| 边框、圆角、阴影 | `border border-solid rounded-lg shadow-md ring-2 ring-blue-500`                     |
| 静态形变与 SVG   | `translate-x-2 scale-90 rotate-12`, `fill-blue-500 stroke-2`                        |
| 任意静态值       | `[padding:12px]`, `bg-[linear-gradient(red,blue)]`                                  |

这里只接受作用于当前元素的简单类规则，以及表中对应的静态属性。以下情况会抛错，不会悄悄丢弃样式：

- 未知类；响应式、状态或任意选择器变体，如 `sm:`、`hover:`、`dark:`、`[&>div]:`。
- `space-*`、`divide-*`、`container` 等依赖子选择器或条件规则的工具类。
- `!important`、动画、过渡、滤镜、光标与事件行为。
- `fixed`、`sticky`、固定背景，以及 `url()`、`image-set()`、`attr()`、`env()` 等依赖外部资源或环境的值。
- 只设置内部变量、没有对应展示属性的组合，如单独的 `shadow-blue-500`；它应与 `shadow-md` 等实际展示工具类一起使用。

修饰变量必须与实际展示工具类放在同一个元素上。例如 `flex shadow-blue-500` 仍然只有 Flex 布局，不会凭空产生阴影，这与 Tailwind CSS 的组合语义一致。

Tailwind 4 的部分渐变工具类会生成 `@supports`，因此会被拒绝；明确的静态任意值渐变可使用。CSS 值仍须满足目标浏览器的语法，本包不替代浏览器的完整 CSS 校验。

不支持直接导入 `.css`、CSS Modules、Sass、Less、Stylus 或作者自定义 PostCSS 流程。不扫描文件、不安装 Tailwind 插件、不读取 `tailwind.config`，不添加 `className` 或修改 JSX 树。

这里不注入 Tailwind Preflight 或任何全局重置。若需要盒模型或字体基线，在相应元素明确使用 `box-border`、`font-sans` 等工具类。

## 生命周期

建议按插件或主题创建工厂并复用。每个工厂最多缓存 256 个结果组合，最多接收 4096 个不同工具类（包含失败的编译输入）；到达上限后，新类会报错，已有类仍可使用。每次调用最多 256 个类、16384 个字符。需要另一套动态样式集合时创建新工厂，旧工厂可随作用域释放。

包内默认主题来自固定版本 `tailwindcss@4.3.3/theme.css`，保留其 MIT 许可。维护者升级该依赖后运行 `pnpm sync:theme`；构建会检查主题快照是否一致。

参考：[Tailwind 主题](https://tailwindcss.com/docs/theme)、[Tailwind 兼容性](https://tailwindcss.com/docs/compatibility)、[官方编译器](https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/src/index.ts)。
