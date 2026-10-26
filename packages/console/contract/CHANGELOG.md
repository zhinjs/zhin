# @zhin.js/contract

## 1.1.13

### Patch Changes

- Updated dependencies [0dd657d]
- Updated dependencies [5d099f5]
- Updated dependencies [f9ab410]
  - @zhin.js/ai@1.1.45

## 1.1.12

### Patch Changes

- Updated dependencies [f98025b]
- Updated dependencies [9e21404]
- Updated dependencies [de39053]
- Updated dependencies [250b026]
- Updated dependencies [bff8e31]
- Updated dependencies [bf0fa9f]
- Updated dependencies [3326db3]
- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/ai@1.1.44

## 1.1.11

### Patch Changes

- Updated dependencies [974fa85]
- Updated dependencies [d9cc732]
  - @zhin.js/ai@1.1.43

## 1.1.10

### Patch Changes

- Updated dependencies [d13b1d7]
- Updated dependencies [1971e0c]
- Updated dependencies [a383380]
  - @zhin.js/console-protocol@1.1.11
  - @zhin.js/ai@1.1.42

## 1.1.9

### Patch Changes

- Updated dependencies [7edd04c]
- Updated dependencies [2b4d6dc]
- Updated dependencies [b58548a]
- Updated dependencies [e914a93]
  - @zhin.js/console-protocol@1.1.10

## 1.1.8

### Patch Changes

- Updated dependencies [d033076]
  - @zhin.js/ai@1.1.41

## 1.1.7

### Patch Changes

- Updated dependencies [dd7f25f]
  - @zhin.js/ai@1.1.40

## 1.1.6

### Patch Changes

- 75e26a6: Raise the supported Node.js range to `>=22.19.0` (was `^20.19.0 || >=22.12.0`). `@zhin.js/ai` depends on undici 8, whose `engines` require Node >=22.19.0; on Node 20 it crashes at import (`webidl.util.markAsUncloneable is not a function`). CI already tests only Node 22 / 24 / 26. `zhin doctor`, `zhin new`, `zhin migrate` and `create-zhin-app` now check for and write the same range.
- fdc2148: Unblock external plugin authors.

  - Published manifests no longer expose the source-only `development` export condition (it pointed at `./src/*.ts`, which is not in the tarball, so Vitest 4 and other tools that enable `development` failed to import Zhin packages). Each package now carries `publishConfig.exports` without that condition; `pnpm publish` swaps it in when packing, and the monorepo keeps source-level development.
  - `zhin new` no longer crashes without arguments (uses inquirer `select` instead of the removed `list` prompt; same fix for `zhin onboard` and `zhin pub`). The generated package.json uses `^x.y.z` ranges derived from installed versions instead of `latest`, declares capability packages as optional peers (plus devDependencies for local tests) instead of dependencies, sets `zhin.entry` to `./plugin.js` and builds sibling JavaScript on `prepack`, fixes the adapter template test, and adds `--package-name`. `--skip-install` now also skips the project-root install.

- Updated dependencies [a64716a]
- Updated dependencies [75e26a6]
- Updated dependencies [75e26a6]
- Updated dependencies [cc9959e]
- Updated dependencies [fdc2148]
  - @zhin.js/ai@1.1.39
  - @zhin.js/console-protocol@1.1.9

## 1.1.5

### Patch Changes

- Updated dependencies [c829031]
- Updated dependencies [0c17e0b]
- Updated dependencies [bf52b40]
- Updated dependencies [55811d1]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [bf52b40]
- Updated dependencies [fc75499]
- Updated dependencies [2a9d08b]
- Updated dependencies [e4fbfb2]
- Updated dependencies [56bafda]
- Updated dependencies [7d2263c]
- Updated dependencies [27da0e8]
- Updated dependencies [7d2263c]
- Updated dependencies [d91d21a]
- Updated dependencies [a62acca]
- Updated dependencies [9ab9ffb]
- Updated dependencies [1280631]
- Updated dependencies [bd78a94]
- Updated dependencies [acfaaef]
- Updated dependencies [57ea5f7]
- Updated dependencies [6e035e5]
- Updated dependencies [57ea5f7]
- Updated dependencies [55db42d]
- Updated dependencies [f48ba72]
- Updated dependencies [3237f63]
- Updated dependencies [8e26cf1]
- Updated dependencies [9891e66]
- Updated dependencies [4778587]
- Updated dependencies [681abf3]
  - @zhin.js/ai@1.1.38
  - @zhin.js/console-protocol@1.1.8

## 1.1.4

### Patch Changes

- Updated dependencies [b36452a]
  - @zhin.js/ai@1.1.37

## 1.1.3

### Patch Changes

- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
- Updated dependencies [b9b3953]
  - @zhin.js/console-protocol@1.1.7
  - @zhin.js/ai@1.1.36

## 1.1.2

### Patch Changes

- Updated dependencies [36c2eb9]
- Updated dependencies [95b24d4]
  - @zhin.js/ai@1.1.35

## 1.1.1

### Patch Changes

- f474b1d: Replace the process-wide Console application, runtime environment, and WebSocket singleton with an explicitly created `ConsoleClient` that owns its application registry and REST/SSE transport. React transport hooks now resolve that owner through `ConsoleClientProvider`, and the obsolete `addPage` compatibility alias is removed from the plugin registration contract.
- Updated dependencies [1414ccb]
- Updated dependencies [62dee52]
- Updated dependencies [244e475]
- Updated dependencies [1fa1c09]
- Updated dependencies [75920c4]
- Updated dependencies [cd4f240]
- Updated dependencies [4bc3d3c]
- Updated dependencies [77d5a46]
- Updated dependencies [baef56b]
- Updated dependencies [698f16f]
- Updated dependencies [507d602]
  - @zhin.js/ai@1.1.34
  - @zhin.js/console-protocol@1.1.6

## 1.1.0

### Minor Changes

- 1fc6270: Reset all 88 published official packages onto the owner-governed 1.1.x stable line. Packages whose historical 1.1.0 version is still available publish as 1.1.0; packages where npm permanently reserves that version use the next available 1.1.x patch. Historical higher version lines remain installable but are superseded, and routine releases after this reset are patch-only.

### Patch Changes

- Updated dependencies [1fc6270]
  - @zhin.js/ai@1.1.33
  - @zhin.js/console-protocol@1.1.5

## 1.0.19

### Patch Changes

- Updated dependencies [882a08a]
  - @zhin.js/ai@1.5.9

## 1.0.18

### Patch Changes

- Updated dependencies [d85eddd]
  - @zhin.js/ai@1.5.8

## 1.0.17

### Patch Changes

- Updated dependencies [09b14d6]
  - @zhin.js/ai@1.5.7

## 1.0.16

### Patch Changes

- Updated dependencies [b10d058]
- Updated dependencies [f2c532f]
  - @zhin.js/console-protocol@1.1.4

## 1.0.15

### Patch Changes

- Updated dependencies [5969c5b]
- Updated dependencies [974772e]
- Updated dependencies [5969c5b]
- Updated dependencies [2f786bd]
- Updated dependencies [1312ca0]
- Updated dependencies [985fa22]
  - @zhin.js/console-protocol@1.1.3
  - @zhin.js/ai@1.5.6

## 1.0.14

### Patch Changes

- Updated dependencies [0b8b5bd]
  - @zhin.js/ai@1.5.5

## 1.0.13

### Patch Changes

- Updated dependencies [e4757a8]
- Updated dependencies [c3c0ebf]
  - @zhin.js/console-protocol@1.1.2
  - @zhin.js/ai@1.5.4

## 1.0.12

### Patch Changes

- Updated dependencies [0e73866]
  - @zhin.js/ai@1.5.3

## 1.0.11

### Patch Changes

- Updated dependencies [c50aca3]
- Updated dependencies [daffd4c]
- Updated dependencies [61bfc1c]
- Updated dependencies [f1708c3]
- Updated dependencies [05befc1]
- Updated dependencies [e53444f]
- Updated dependencies [a7df753]
  - @zhin.js/ai@1.5.2

## 1.0.10

### Patch Changes

- f8c7a54: fix: im
- Updated dependencies [f8c7a54]
  - @zhin.js/console-protocol@1.1.1
  - @zhin.js/ai@1.5.1

## 1.0.9

### Patch Changes

- Updated dependencies [1f23bf6]
- Updated dependencies [4fbff5d]
- Updated dependencies [5b94d9c]
  - @zhin.js/ai@1.5.0

## 1.0.8

### Patch Changes

- Updated dependencies [d8bf702]
  - @zhin.js/ai@1.4.8

## 1.0.7

### Patch Changes

- Updated dependencies [f346346]
  - @zhin.js/ai@1.4.7

## 1.0.6

### Patch Changes

- Updated dependencies [5691aba]
  - @zhin.js/ai@1.4.6

## 1.0.5

### Patch Changes

- Updated dependencies [ac9da66]
  - @zhin.js/console-protocol@1.1.0

## 1.0.4

### Patch Changes

- @zhin.js/ai@1.4.5

## 1.0.3

### Patch Changes

- 872c583: Slack 适配器 Phase 1/2：mrkdwn 出站、长消息切分、斜杠/按钮 ephemeral 反馈、入站 mrkdwn→Markdown、editMessage 对齐 core。

  Logger 表格日志与 string-width 列宽；Agent AI Handler 框线表格与 introspection/MCP 导出；Core side-event 归一化；Schedule 时区规划；多适配器 side-event 与 API surface 更新。

- 872c583: fix: 代码格式优化
- Updated dependencies [872c583]
  - @zhin.js/ai@1.4.4

## 1.0.2

### Patch Changes

- 5cc9c03: fix: ai 优化

## 1.0.1

### Patch Changes

- c8f8207: fix: 修复内存泄露问题
