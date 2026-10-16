---
"@zhin.js/cli": patch
"create-zhin-app": patch
---

独立插件的官方创建入口统一为 `zhin new <name> --standalone`（外部插件作者用 `npx @zhin.js/cli new my-plugin --standalone`，在当前目录生成 `./<name>/`，不依赖也不修改 Bot 项目）。`zhin runtime init/create` 标为已弃用；`create-zhin-app` 完成提示里 404 的“写插件”链接改为有效页面。
