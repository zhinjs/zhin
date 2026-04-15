# 单仓库 monorepo（无 git submodule）

本仓库以 **pnpm workspace** 管理多包；子路径均为**同一 Git 历史**下的普通目录，不再通过 submodule 挂载外部仓库。

## 新克隆

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
pnpm install
```

无需 `git submodule update`。

## 从「仍带子模块元数据」的旧克隆迁移

若根目录存在 `.gitmodules`，且部分路径在 `git status` 中显示为 **gitlink（子模块指针）**，可在仓库根目录执行（需网络，会按 `.gitmodules` 浅克隆各 url 到原 path 并移除嵌套 `.git`）：

```bash
bash scripts/submodule-to-monorepo-import.sh
git add -A
git status
```

脚本无 `.gitmodules` 时会直接退出（视为已迁移）。完成后应提交一次大变更（例如 `chore: inline former submodules`），再跑 `pnpm install` 与 `pnpm build` 做验证。

## CI / 自动化

工作流使用普通 `actions/checkout`，**不要**再开启 `submodules: recursive`。

## 更多约定

目录与包命名事实来源见 [repo-structure.md](./repo-structure.md)。
