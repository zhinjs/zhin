---
"@zhin.js/client": patch
---

`AdapterConsolePage` 新增嵌入模式，供宿主页面（例如 Console 的适配器概览）把它放进自己的页面：`embedded` 不再渲染 SDK 页头（标题、标识、说明与「刷新」），也去掉页面内边距与宽度上限；`toolbar` 把页面动作（文档链接、添加账号的开关与禁用状态、刷新）交给宿主用自己的按钮渲染，不传时显示 SDK 自带的「文档」「添加」；`refreshKey` 变化时重读状态、连接与登录待办，供宿主的「刷新」按钮驱动。宿主可读 `AdapterConsolePage.capabilities` 或 `ADAPTER_CONSOLE_PAGE_CAPABILITIES` 判断支持情况；不传这些属性时页面与之前完全相同。
