# Toolkit Runtime

Toolkit 提供可选的展示、渲染、语音能力与项目脚手架，不进入 IM 核心默认安装。

| 包 | 职责 | 入口 |
| --- | --- | --- |
| components | 无状态 JSX 样式组件与主题；依赖 JSX 基础包、entities、marked 与 Shiki | Card、Row、KvTable、图表等 |
| html-renderer | HTML→PNG；CLI 将 renderer 安装为 generation Resource | createHtmlRenderer |
| tailwind | 可选静态工具类 → 内联样式；官方 Tailwind 编译 | createTailwindStyle |
| speech | STT/TTS；由 composition root 装配 Speech Host | createSpeechPipeline |
| scaffold-wizard | create-zhin-app、zhin setup 共用的配置与依赖诊断 | apply、diagnoseOptionalPeers |
| create-zhin | 新建项目文件树 | workspace 生成器 |

JSX 的唯一契约与 serializer 在 `packages/im/jsx`，公开作者入口是 `zhin.js/jsx`。components 返回 JSX 树；Core 将树序列化为 HTML 段，按 Adapter 声明保留 HTML、调用可选 renderer 生成图片或降级文本。html-renderer 使用 @pixel.js/shotium，不提供其他 JSX runtime，也不发送消息。

Host 仅由 CLI composition root 装配，使用当前 operation 的 snapshot Resource。用户代码通过统一消息发送链，不在组件内手写平台上传或读取模块级最新 generation。
