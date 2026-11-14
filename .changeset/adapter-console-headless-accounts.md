---
"@zhin.js/client": minor
---

适配器 Console 页：新增 headless 账号 API，宿主可以把账号的状态、启停开关和操作并进自己的账号列表（zhinjs/zhin#1250）。`AdapterAccountsProvider` + `useAdapterAccounts()` 返回账号行（状态、开关文字「运行中 / 已停止」、`setEnabled` / `start` / `stop` / `edit` / `remove` / `test`、`can` / `busy` / `disabled`）与 `notice`、迁移确认、`blocked`、`add`、`editing`，内部沿用页面原有的 revision、迁移确认与 `commit_unknown` 处理；`AdapterAccountEditor` 只渲染编辑表单。`AdapterConsolePage` 新增 `renderRow`（每行插槽）与 `hostAccounts`（账号列表、编辑表单与账号提示交给宿主），`ADAPTER_CONSOLE_PAGE_CAPABILITIES` 相应标明。账号卡片的开关改为带文字说明的可键盘操作开关，去掉与开关重复的「启动 / 停止」按钮；账号头像改为适配器显示名首字。需要迁移时提示里加「立即迁移」（确认后提交一次不改字段的更新）并说明迁移后账号以数据库为准、配置文件中的 `endpoints` 不再生效；不能这样迁移的适配器说明会在第一次编辑或启停时确认。页面在弹性 / 网格父容器里撑满宿主内容列，不再缩成一列窄卡片。
