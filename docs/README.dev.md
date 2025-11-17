# Docs 工作区说明

## 改进点

docs 现在是一个独立的 pnpm 工作区，具有以下优势：

1. **独立依赖管理**：只安装文档构建所需的依赖（vitepress 和 vue），不会安装整个项目的所有依赖
2. **更快的安装速度**：构建文档时只需要安装 2 个主要依赖，而不是整个 monorepo 的数百个依赖
3. **更小的 CI/CD 占用**：在 CI/CD 环境中构建文档时，可以只安装 docs 工作区的依赖

## 使用方法

```bash
# 开发模式
pnpm docs:dev

# 构建文档
pnpm docs:build

# 预览构建结果
pnpm docs:preview
```

## 单独安装 docs 依赖

```bash
# 只安装 docs 工作区的依赖
pnpm install --filter @zhin.js/docs
```

## 文件结构

```
docs/
├── package.json        # docs 工作区的 package.json
├── .vitepress/         # VitePress 配置
├── *.md               # 文档文件
└── node_modules/       # 只包含 vitepress 和 vue 的符号链接
```
