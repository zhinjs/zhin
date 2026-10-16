---
"@zhin.js/cli": patch
"create-zhin-app": patch
---

独立插件的官方创建入口统一为 `zhin new <name> --standalone`（外部插件作者用 `npx @zhin.js/cli new my-plugin --standalone`，在当前目录生成 `./<name>/`，不依赖也不修改 Bot 项目；Bot 项目内的本地插件继续用 `zhin new <name>`）。已删除 `zhin runtime init` 和 `zhin runtime create`（及导出的 `ProjectScaffolder`）：新建插件请改用 `zhin new`，新建项目用 `npm create zhin-app`。`create-zhin-app` 完成提示里 404 的“写插件”链接改为有效页面，插件开发提示改为 `zhin new`。
