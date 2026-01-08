# 📜 Zhin.js 脚本工具

本目录包含用于 Zhin.js 项目维护和插件开发的实用脚本。

## 🛠️ 可用脚本

### 1. `check-plugin-spec.mjs` - 插件规范检查工具

检查插件的 `package.json` 是否符合 Zhin.js 发布规范。

**用法：**

```bash
# 检查当前目录的 package.json
node scripts/check-plugin-spec.mjs

# 检查指定的 package.json
node scripts/check-plugin-spec.mjs path/to/package.json

# 使用 npm script（在项目根目录）
pnpm check:plugin path/to/package.json
```

**检查项目：**

- ✅ 包名命名规范
- ✅ 描述格式规范
- ✅ 关键词完整性
- ✅ 作者信息（姓名、邮箱、主页）
- ✅ 依赖配置（peerDependencies vs dependencies）
- ✅ 仓库信息
- ✅ 许可证
- ✅ 发布配置
- ✅ 模块类型
- ✅ 文件包含配置

**示例输出：**

```
📦 Zhin.js 插件规范检查

包名: @zhin.js/adapter-kook
版本: 1.0.19
类型: module

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 恭喜！你的插件完全符合规范！

📝 下一步：
  1. 运行 pnpm build 构建插件
  2. 运行 pnpm test 测试插件
  3. 运行 pnpm publish 发布到 npm
```

### 2. `list-packages-for-trusted-publishing.mjs` - npm Trusted Publishing 配置助手

列出所有需要配置 npm Trusted Publishing 的包，并提供直接配置链接。

**用法：**

```bash
node scripts/list-packages-for-trusted-publishing.mjs
```

### 3. `check-production-config.js` - 生产环境配置检查

检查生产环境配置是否正确。

**用法：**

```bash
pnpm check:prod
```

## 📚 相关文档

- [插件发布规范指南](../docs/plugin/publishing-guide.md)
- [插件开发指南](../docs/plugin/development.md)
- [npm Trusted Publishing 配置](../.github/TRUSTED_PUBLISHING_SETUP.md)

## 💡 开发者提示

### 插件开发者

如果你正在开发 Zhin.js 插件，请务必：

1. **运行规范检查**：`pnpm check:plugin` 确保符合发布规范
2. **填写完整的作者信息**：包括邮箱（插件市场收录必需）
3. **使用 peerDependencies**：不要在 dependencies 中依赖 zhin.js
4. **编写 README**：提供清晰的安装和使用说明

### 核心开发者

维护项目时的常用脚本：

```bash
# 构建所有包
pnpm build

# 运行测试
pnpm test

# 创建 changeset
pnpm release

# 更新版本号
pnpm bump

# 发布到 npm
pnpm pub

# 检查插件规范
pnpm check:plugin plugins/adapters/kook/package.json
```

## 🤝 贡献

如果你有新的实用脚本想要添加，欢迎提交 PR！

请确保：
- 脚本有清晰的注释
- 提供使用示例
- 更新本 README 文档

