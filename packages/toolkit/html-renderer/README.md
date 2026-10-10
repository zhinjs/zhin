# @zhin.js/html-renderer

HTML → 图片，供 Zhin.js 出站富媒体段（`segment.html` / `segment.markdown`）与可选 `aiTextAsImage` 使用。

现在只使用 **[@pixel.js/shotium](https://www.npmjs.com/package/@pixel.js/shotium)（裁剪版 Chromium）** 渲染，不再依赖 `satori + resvg`。

## 安装

```bash
pnpm add @zhin.js/html-renderer
```

未安装时，`html: 'image'` 的 HTML 出站段降级为文本；原生 HTML 与纯文本平台按 Adapter 的声明处理。

## 配置（zhin.config.yml）

```yaml
htmlRenderer:
  width: 1080
  viewport:
    height: 600
  backgroundColor: "#ffffff"
  scale: 1
  aiTextAsImage: false
```

兼容旧字段 `defaultWidth` / `defaultBackgroundColor` / `defaultFonts`；新后端还支持 `viewport`、`scale`、`timeout`、`waitUntil`、`fontFamily`、`allowFileAccess`、`cacheDir`、`cacheMaxBytes`、`userAgent`、`idleTimeoutMs`、`logStats`、`mode: inprocess | daemon`。

## API

```typescript
import { createHtmlRenderer } from '@zhin.js/html-renderer';

const renderer = createHtmlRenderer({ width: 540 });
const png = await renderer.render('<div>Hello</div>', { format: 'png' });
const webp = await renderer.render('<div>Hello</div>', { format: 'webp' });
```

- 输出支持 `png`（默认）、`jpeg`、`webp`。`format` 覆盖配置中的 `type`，返回格式和 MIME 与实际编码一致。
- 不支持 SVG；传入未知格式会抛出 `TypeError`。
- JSX 统一使用 `zhin.js/jsx` 的 `renderToHtml()` 生成 HTML，然后交给 `render()`；本包不提供 JSX runtime 或组件入口。

CLI 将可选 renderer 装配为 generation Resource，Core 的统一出站链调用，业务代码通常只需 `segment.html({ html: '...' })`。

## 运行环境与字体

本包按 npm 已发布的 Shotium 0.12.1 接口使用同步 `start()` 与 `releaseMemory()`，不会依赖 GitHub 主分支尚未发布的接口。SDK 导入时不启动引擎，首次渲染时加载对应平台的原生包；安装时需要保留 optional dependencies。支持 Windows、macOS，以及 glibc／musl 的 Linux，均有 x64 和 arm64 构建。

默认 `mode: inprocess` 使用进程内共享的 Blink 引擎；其缓存目录与 User-Agent 在进程内固定，不能在热重载时改为另一套配置。SDK 拒绝不一致配置时，本包也会保留该错误。`mode: daemon` 将引擎放在独立进程中，由 SDK 按配置定位服务。

Shotium 渲染静态 HTML/CSS，不执行页面 JavaScript。字体默认来自系统；精简 Linux 镜像需安装所需的中文和 Emoji 字体，或通过 `defaultFonts`／`registerFont()` 提供字体数据。设置 `fontFamily` 时应使用字体的真实名称。`allowFileAccess: false` 会阻止本地字体和其他文件资源的加载。

Linux 的远程 HTTPS 资源使用 Shotium 自带的信任库，企业私有 CA 不能仅依靠系统证书自动生效；内网资源可提前读取，作为本地文件交付。生成消息不需要外部 URL。

## 当前验收限制

在 macOS arm64 / Node 24 的本地验收中，Shotium 0.12.1 曾在子进程退出清理时发生一次原生 `SIGSEGV`，堆栈包含 `napi_remove_async_cleanup_hook`。随后 20 轮退出压力复验未再出现，但原因仍未确认，不能据此认定已修复。截图测试保留退出失败检查；本次接入提交供审查，不代表已完成生产稳定性或实机 IM 投递验收。
