---
"@zhin.js/adapter-satori": patch
---

对齐 Satori 出站元素和被动回复的 `referrer`。

**破坏性变更：** `at` / `mention` 不再编成 `@name`，图片、音频、视频和文件不再编成 `[image:src]` 这类纯文本，改为标准元素 `<at>`、`<img>`、`<audio>`、`<video>`、`<file>`，并支持 `<emoji>`。入站 `content` 仍是协议原文，这些元素会另外解成段。

收到带 `referrer` 的事件时，同一次处理里的 `message.create` 会原样带回该对象；之后的主动发送不带。`guild-emoji-added` / `guild-emoji-updated` / `guild-emoji-deleted` 映射为 `notice.group.emoji_added` / `emoji_updated` / `emoji_deleted`。

`@imhelper/satori-v1` 还没有这些类型（上游 `feat/satori-1.3-alignment` 未发布）。适配器使用本地类型，上游发版后可以换成官方类型。
