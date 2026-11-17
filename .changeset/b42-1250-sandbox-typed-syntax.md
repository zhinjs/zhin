---
"@zhin.js/adapter-sandbox": patch
---

Sandbox 输入框里手打的 `[image:URL]` 等写法发送时解析成对应的消息段，与按钮插入的结果相同（#1250 第 42 批，`sandbox-typed-media-syntax-sent-as-text`）。

- 原因：只有按钮插入的媒体节点会变成 `image` 段，手打的 `[image:URL]` 在编辑器里是普通文本，发送时原样成为一个 `text` 段；端点也只展开 `[@名称]`。所以消息里没有图片段，Agent 没有识图，只能凭链接名猜内容。而「快捷操作与语法」却把 `[image:URL]` 列成了可用写法。
- 写法表与解析器合并为 `src/inbound-syntax.ts`：`[@名称]`、`[face:ID]`、`[image:URL]`、`[video:URL]`、`[audio:URL]`、`[file:URL]`。页面发送前、页面预览、端点收到文本段时都用它展开；编辑器按钮插入的段也由同一组函数构造，所以手打与按钮插入完全一致。端点对直接连 WebSocket 的客户端同样生效。
- `URL` 须是 `http(s)` 链接；图片、视频、音频也接受同类型的 base64 `data:` URL。链接不合法（例如 `javascript:`、本地路径、`file://`、类型不符的 `data:`）的写法保留为文本，页面提示「…不是可用的链接…已按文本发送」。
- 「快捷操作与语法」改为直接渲染这张表：只保留 Enter / Shift+Enter 两个快捷键，删去发送时不会解析成消息段的 `**文本**` 与 ```` ``` ```` 两项；新增守卫测试，表里多一项而解析器不支持、或解析器支持而表里没列时测试失败。
- 粘贴的图片（`data:` URL）改为 `base64` 媒体引用：之前作为 `kind: 'url'` 发出，Agent 的入站媒体按网络地址处理会拒绝 `data:`，粘贴的图片同样到不了识图。
- 只含媒体的消息，纯文本不再回退成原始 WebSocket 帧（之前按钮插入一张图、不写文字时，消息文本是整段 JSON），现在为空字符串；媒体写法本身也不出现在纯文本里。
- 手打的 `data:` 写法只接受 Console 能内联显示的类型（图片 png / jpeg / gif / webp / avif，视频 mp4 / ogg / webm，音频 mpeg / mp4 / ogg / wav / webm）；`image/svg+xml` 等保留为文本，入站段里声明的 `mime_type` 不会是可执行的类型。值统一成小写头、去掉空白的规范形式。
