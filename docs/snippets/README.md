# 文档片段（VitePress SSOT）

可复用 Markdown 片段，供站点内 `<<<` 引用，避免多页重复维护。

## Install tiers

| 文件 | 用途 |
|------|------|
| [`install-tiers.md`](./install-tiers.md) | zhin.js 4.x 安装分档表、breaking、import 表、安装命令 |

### 引用方式

在 `docs/**/*.md` 中（路径相对当前文件）：

```md
<<< ../snippets/install-tiers.md#tiers-table

<<< ../snippets/install-tiers.md#breaking

<<< ../snippets/install-tiers.md#imports
```

可用区域名见 `install-tiers.md` 内 `<!-- #region ... -->` 注释。

### 非 VitePress 文件

仓库根 `README.md`、`packages/im/zhin/README.md` 无法使用 `<<<`，改表时请**同步** `install-tiers.md`，或链到 [快速开始 — Install tiers](https://zhin.js.org/getting-started/#install-tierszhinjs-4x)。

### 验证

```bash
pnpm docs:build
pnpm check:doc-links
pnpm check:install-tiers-ssot
```
