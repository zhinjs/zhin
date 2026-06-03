# packages/

框架与控制台相关的 **npm 包**（pnpm workspace）。按域分子目录，**npm 包名不变**（如 `@zhin.js/core`）。

## 目录

```
packages/
  im/           # IM 机器人主链（单向依赖）
    kernel/
    ai/
    core/
    agent/
    zhin/
  console/      # 控制台栈（与 IM 平行）
    contract/
    pagemanager/
    client/
  toolkit/      # 脚手架与独立库
    create-zhin/
    scaffold-wizard/   # 共享项目配置向导（create-zhin-app + zhin setup）
    satori/
  host/         # Host 运行时（router、api、mcp）
    router/
    api/
    mcp/
```

根目录 **`zhin-console/`** 为 Remote Console 静态 UI（git submodule），不在 `packages/console/` 内。

## 构建顺序（Host）

`contract` → `pagemanager` → `client` → `packages/host/router` → `packages/host/api`

IM 主链：`kernel` → `ai` → `core` → `agent` → `zhin`

详见 [docs/contributing/repo-structure.md](../docs/contributing/repo-structure.md)。
