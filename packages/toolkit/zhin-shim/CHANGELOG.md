# zhin

## 4.0.1

### Patch Changes

- d1302e5: 新增 npm 包 `zhin`（4.x）：`@zhin.js/cli` 的别名，`npx zhin <命令>` 等同于 `npx @zhin.js/cli <命令>`。旧的 `zhin@3.x` 不受影响。
- a1b362c: `npx zhin` 现在优先使用当前工作目录项目自己安装的 `@zhin.js/cli`（从 `process.cwd()` 解析），找不到时才回退到 shim 自身依赖的版本，避免运行与项目锁定版本不一致的 CLI。
- a4fc852: 发布 `zhin` 4.x 兼容包（转发到 `@zhin.js/cli`）。首个 4.x 正式版本为 `4.0.1`：`package.json` 基线改为 `4.0.0`，避免预发布版本号 `4.0.0-0` 让发版计划检查找不到版本基线；`4.0.0` 不会发布。
- Updated dependencies [6fdd30b]
- Updated dependencies [90057de]
- Updated dependencies [58b46ba]
- Updated dependencies [36d2880]
- Updated dependencies [8302701]
- Updated dependencies [b8317b0]
- Updated dependencies [9943df6]
- Updated dependencies [a3ab153]
- Updated dependencies [61cca0b]
- Updated dependencies [e8f7309]
- Updated dependencies [d87ada2]
- Updated dependencies [53a3f35]
- Updated dependencies [a2ed9ce]
- Updated dependencies [c5741c0]
- Updated dependencies [a13029a]
- Updated dependencies [d13b1d7]
- Updated dependencies [1971e0c]
- Updated dependencies [f7c7bdc]
- Updated dependencies [c618eb7]
- Updated dependencies [a383380]
- Updated dependencies [b3bbada]
- Updated dependencies [2264a99]
- Updated dependencies [c9087a9]
  - @zhin.js/cli@1.1.15
