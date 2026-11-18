---
'@zhin.js/client': minor
'@zhin.js/console-ui': minor
'@zhin.js/console-contract': minor
'@zhin.js/pagemanager': patch
'@zhin.js/cli': patch
'@zhin.js/adapter-sandbox': patch
---

ADR 0063 P4：删除弃用期已满（至少一个 minor）的接口。按 ADR 0063 D11（所有者决定），删除走 minor，不等 major。

`@zhin.js/client`（1.3.0 弃用）：

- 删除 `@zhin.js/client/ui` 子路径（`exports["./ui"]`）及其 `zk-` 组件（`PluginPage`、`PageHeader`、`Button`、`Select`、`Modal`、`ConfirmButton` 等）和 `pluginUiStyles`。数据、语言、插件 ID 工具、声明式渲染器与会话选择工具从 `@zhin.js/client` 根入口导入（名字不变）；组件改用 `@zhin.js/console-ui`；页头交给页面外壳（`usePageChrome`）。
- 删除 `adapterConsoleStyles`、`conversationPickerStyles`（弃用期内为空字符串）：删掉导入和注入它们的 `<style>`。
- 删除 `zk-` 类名：适配器页账号编辑器不再带 `zk-account-editor-host`，宿主改用 `[data-adapter-account-editor]` 定位。
- 蓝图与评论审批 spec 不再读取 `mark`，也不再为它告警。

`@zhin.js/console-contract`（1.3.1 标注、随 client 1.3.0 这一轮宣布弃用）：删除 `DeclarativePageSpec.mark` 与 `CommentReviewBlueprintSpec.mark`，写了会报类型错误，删掉即可。

`@zhin.js/console-ui`（1.1.0 弃用）：

- 删除旧令牌别名 `--console-radius-sm/md/lg/xl/2xl`、`--console-shadow-xs/sm/md/lg/xl/panel/hover/button`、`--console-space-page-x/-y`、`--console-space-section/-stack/-card/-card-sm`、`--console-control-height-sm/-lg`、`--console-border-width`、`--console-focus-width`、`--console-duration-fast/-page`、`--console-text-caption/-code/-body-sm/-section-sm/-title-compact`、`--radius`，以及无后继的 `--console-shadow-ring`。对照：`radius-sm/md/lg/xl/2xl` → `radius-1/2/3/4/4`；`shadow-xs/button` → `elevation-0`，`shadow-sm/panel` → `card-elevation`，`shadow-md` → `elevation-2`，`shadow-lg/xl` → `elevation-3`，`shadow-hover` → `card-hover-elevation`；`space-page-x/-y` → `page-padding-inline/-block`，`space-section` → `section-gap`，`space-stack` → `stack-gap`，`space-card(-sm)` → `card-padding`；`control-height-sm/-lg` → `control-height-compact` / `control-height`；`border-width` / `focus-width` → `border-hairline` / `border-focus`；`duration-fast/-page` → `motion-fast` / `motion-base`；`text-caption/-code/-body-sm` → `text-label`，`text-section-sm` → `text-section`，`text-title-compact` → `text-title`；`--radius` → `--console-control-radius`（均带 `--console-` 前缀）。`scale.json` 的 `css.aliasTokens` 改为 `css.removedTokens`（旧名 → 新名）。
- stylelint 规则 `console/no-deprecated-tokens` 改为报出这些已删除的名字并给出新名；`createConsoleStylelintConfig({ deprecatedTokens })` 不变。
- 删除 `Button` 的 `variant="default"`（1.1.0 起是 `soft` 的弃用别名）：改写 `variant="soft"`，或不写 `variant`（默认就是 `soft`）。

`@zhin.js/pagemanager`：独立页外壳的样式不再覆盖 `.zk-root` / `--zk-*`，构建时注入的 `defineCommentReviewPage` 不再把 `mark` 写进蓝图。`@zhin.js/cli`：`zhin plugin check` 第 2 条在从 `@zhin.js/client/ui` 引入 `PageHeader` / `PluginPage` 的提示中注明该子路径已在 `@zhin.js/client` 1.4.0 删除。`@zhin.js/adapter-sandbox`：按钮由已删除的 `variant="default"` 改为 `soft`，外观不变。

第三方插件：已经构建好的插件把自己用的 `@zhin.js/client` 打进了包里，子路径和 `zk-` 的删除不会让它们失效，升级依赖重新构建时按 docs/authoring/console-pages.md「从 @zhin.js/client/ui 升级」与「ADR 0063 P4 删除的其他接口」迁移。`@zhin.js/console-ui` 由 Console 作为共享单例提供，Console 升级到 1.2 后，还在用 `variant="default"` 的按钮会退回基础样式，读旧令牌名的样式取不到组件库的值，请改成新名。
