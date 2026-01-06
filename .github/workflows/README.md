# GitHub Actions 工作流说明

本目录包含 Zhin.js 项目的所有 CI/CD 工作流配置。

## 工作流列表

### 1. `ci.yml` - 持续集成

**触发条件**：
- Push 到 `main` 分支
- Pull Request 到 `main` 分支

**功能**：
- ✅ 运行测试
- ✅ 构建所有包
- ✅ 使用 Changesets 管理版本
- ✅ 自动发布到 npm（使用可信发布）

**关键特性**：
- 使用 OIDC 可信发布，无需 `NPM_TOKEN`
- 自动生成 Provenance 证明

### 2. `publish.yml` - npm 发布

**触发条件**：
- Push 标签（格式：`v*`，如 `v2.0.0`）
- 手动触发（workflow_dispatch）

**功能**：
- ✅ 构建所有包
- ✅ 运行测试
- ✅ 发布到 npm

**关键特性**：
- 使用 OIDC 可信发布
- 自动生成 Provenance
- 支持手动触发

**使用方法**：
```bash
# 创建并推送标签
git tag v2.0.0
git push origin v2.0.0

# 或手动触发
# 访问 Actions → Publish to npm → Run workflow
```

### 3. `release.yml` - GitHub Release

**触发条件**：
- Push 标签（任意格式）

**功能**：
- ✅ 构建包
- ✅ 运行测试
- ✅ 生成 CHANGELOG
- ✅ 创建 GitHub Release

**特性**：
- 自动从 git 提交生成 CHANGELOG
- 按类型分类提交（Features, Bug Fixes, Maintenance, Dependencies）
- 生成完整的 Release Notes

### 4. `deploy-docs.yml` - 文档部署

**触发条件**：
- Push 到 `main` 分支
- 手动触发

**功能**：
- ✅ 构建文档
- ✅ 部署到 GitHub Pages

## 可信发布配置

### 什么是可信发布？

可信发布使用 OpenID Connect (OIDC) 协议，允许从 GitHub Actions 直接发布包到 npm，无需在 Secrets 中存储长期有效的 `NPM_TOKEN`。

### 优势

- 🔒 **更安全**：使用短期令牌，自动过期
- 🔑 **无需管理令牌**：不需要手动创建、轮换或撤销
- 📝 **自动 Provenance**：为公共包自动生成来源证明
- 🛡️ **降低泄露风险**：令牌不会在日志中暴露

### 配置步骤

详细配置步骤请查看：**[TRUSTED_PUBLISHING_SETUP.md](../TRUSTED_PUBLISHING_SETUP.md)**

快速概览：

1. **在 npmjs.com 上配置**（针对每个包）：
   - 访问包设置 → Publishing access
   - 添加可信发布者：
     - Provider: `GitHub Actions`
     - Repository: `zhinjs/zhin`
     - Workflow: `publish.yml`

2. **GitHub Actions 配置**（已完成）：
   - ✅ 添加 `id-token: write` 权限
   - ✅ 配置 `registry-url`
   - ✅ 移除 `NODE_AUTH_TOKEN`

3. **触发发布**：
   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```

### 需要配置的包

运行以下命令查看所有需要配置的包（共 27 个）：

```bash
node scripts/list-packages-for-trusted-publishing.mjs
```

包括：
- 4 个核心包（`zhin.js`, `@zhin.js/core`, 等）
- 5 个基础包（`@zhin.js/cli`, `@zhin.js/database`, 等）
- 12 个适配器（`@zhin.js/adapter-*`）
- 4 个服务插件（`@zhin.js/console`, `@zhin.js/http`, 等）
- 2 个工具插件（`@zhin.js/plugin-music`, 等）

## 权限说明

### `ci.yml` 和 `publish.yml`

```yaml
permissions:
  id-token: write  # OIDC 可信发布
  contents: read   # 读取仓库内容
```

### `release.yml`

```yaml
permissions:
  contents: write  # 创建 GitHub Release
```

## 环境变量

### 自动提供的变量

- `GITHUB_TOKEN`: GitHub 自动提供，用于访问仓库
- OIDC Token: 使用可信发布时自动生成

### 不再需要的变量

- ❌ `NPM_TOKEN`: 使用可信发布后不再需要

## 故障排查

### 发布失败：Unable to authenticate

**可能原因**：
1. npmjs.com 上未配置可信发布者
2. 工作流文件名不匹配（必须是 `publish.yml`）
3. 仓库信息配置错误

**解决方法**：
- 检查 npmjs.com 上的配置
- 确认工作流文件名为 `publish.yml`（包含 `.yml` 扩展名）
- 验证仓库所有者和名称是否正确

### 测试失败

**可能原因**：
1. 代码错误
2. 依赖安装失败

**解决方法**：
- 查看 Actions 日志
- 本地运行 `pnpm test` 验证

### Provenance 生成失败

**说明**：
- 私有仓库不支持 Provenance
- 私有包不支持 Provenance
- 这是正常行为，不影响发布

## 最佳实践

1. **发布前检查**：
   - ✅ 所有测试通过
   - ✅ 版本号已更新
   - ✅ CHANGELOG 已更新

2. **标签命名**：
   - 使用语义化版本：`v2.0.0`
   - 包含 `v` 前缀

3. **安全性**：
   - ✅ 启用可信发布
   - ✅ 在 npmjs.com 上禁用令牌访问
   - ✅ 定期审计发布配置

4. **监控**：
   - 检查 Actions 日志
   - 验证 npm 上的 Provenance
   - 监控包下载量和问题反馈

## 参考资料

- 📖 [可信发布详细配置](../TRUSTED_PUBLISHING_SETUP.md)
- 📖 [npm 可信发布文档](https://docs.npmjs.com/trusted-publishers)
- 📖 [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- 📖 [Changesets 文档](https://github.com/changesets/changesets)

## 支持

如有问题：
1. 查看 Actions 日志
2. 阅读 [TRUSTED_PUBLISHING_SETUP.md](../TRUSTED_PUBLISHING_SETUP.md)
3. 在项目中提 Issue

