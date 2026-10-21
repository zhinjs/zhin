---
"@zhin.js/testing": patch
---

`@zhin.js/command` 从 `dependencies` 改为 `peerDependencies`：测试工具使用插件自己（经 `zhin.js`）安装的那一份，独立插件不再装出第二份。pnpm / npm 会自动安装 peer，无需改动；yarn 1 等不自动安装 peer 的项目需要执行一次 `yarn add -D @zhin.js/command`。
