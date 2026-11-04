---
"@zhin.js/a2a": patch
"@zhin.js/agent": patch
"@zhin.js/ai": patch
"@zhin.js/ai-provider": patch
"@zhin.js/cli": patch
"@zhin.js/client": patch
"@zhin.js/command": patch
"@zhin.js/component": patch
"@zhin.js/core": patch
"@zhin.js/database": patch
"@zhin.js/feature-kit": patch
"@zhin.js/handler": patch
"@zhin.js/host-http": patch
"@zhin.js/middleware": patch
"@zhin.js/runtime": patch
"@zhin.js/scaffold-wizard": patch
"@zhin.js/schedule-feature": patch
"@zhin.js/service-typesafe": patch
"@zhin.js/tool": patch
"@zhin.js/workroom": patch
"create-zhin-app": patch
---

用统一的 Service／Account／Profile 运行时替换旧 Provider／Catalog 选型入口；支持 Host 订阅账号、固定模型、结构化决策多用途与动态持久选择。命令、工具及委派任务绑定真实 operation／generation，权限、配额与取消不通过全局最新对象传递。

新增显式导入与恢复 journal、只读预览及旧 Session 完整身份绑定；向导单独生成 ai.plan.yml。旧插件接口需要与本次配套 patch 一起迁移，最低版本／旧支持上限与恢复流程见 docs/ai/provider-upgrade.md。本声明不表示版本已经发布，不执行版本提升、登录、真实模型调用、迁移用户数据或部署。
