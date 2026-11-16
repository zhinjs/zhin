---
"@zhin.js/cli": minor
"@zhin.js/runtime": minor
"@zhin.js/component": minor
"@zhin.js/gateway": patch
"zhin.js": patch
---

CLI 与插件作者流程（zhinjs/zhin#1250 第 32 批）：

- `zhin packages status <插件>` 不再把框架字段 `commandNamespace`、`disabledCommands`（以及 `overrides`）报成「不支持的字段」（`missing-config`）：网关校验插件配置时和 Runtime 使用同一份带框架字段的 schema，`additionalProperties: false` 的插件也能写这些字段；Console 保存、安装 / 启用前的配置检查同样生效。`@zhin.js/runtime` 新增 `withFrameworkPluginConfigFields()`。
- `zhin preview`：组件的渲染上下文有了 `use()` / `has()`（此前报 `context.use is not a function`）。组件可以用新的可选字段 `previewServices: [{ token, value }]` 为插件服务提供预览替身；没有替身的 token 会报「预览环境没有提供 <token>，可在组件的 previewServices 里给一个替身」。实例运行时始终使用真实服务。`@zhin.js/component` 新增类型 `ComponentPreviewService`。
- 新增 `zhin ai account list [--json]`：列出 Host 模型账号的 id、名称、服务、引用的环境变量名（不含值）与状态。模型服务管理接口的每个错误码都有中文说明；Host 管理员传入不存在的账号 id 时返回 `account-not-found`，把服务 id 当账号 id 传入时返回 `account-id-is-service`（HTTP 404，此前为笼统的 403 `forbidden`）。
- `zhin watch` 按进程分别显示内存：instance（`/system/status` 的同一次采样）与 gateway（经本机网关套接字读取 `gateway.instance.status`，与 Console 首页「进程与资源」同源），每个数字都标明所属进程；同一次采样中 rss 小于 heapUsed 时给出说明（部分堆内存被系统压缩或换出）。
- `zhin schedule list`：多行内容逐行缩进，超过 2 行截断并提示用新增的 `--json` 查看完整内容。日期时间在 `LANG=en_US` 等任何系统区域下都是 `YYYY-MM-DD HH:mm:ss`（第 22 批的 `formatDateTime()`，本批补了在美国区域与其他时区下运行的测试）。
- `zhin new --help` 说明非交互环境（CI、脚本、无 TTY）必须给出 `--type`；普通插件模板的示例子命令改为 `commands/<name>/echo/[text]`（`<name> echo <文本>`），不再是平级的 `commands/<name>-echo/[text]`。
