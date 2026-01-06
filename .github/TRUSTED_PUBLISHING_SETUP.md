# npm 可信发布配置指南

本文档说明如何为 Zhin.js 项目配置 npm 可信发布（Trusted Publishing）。

## 什么是可信发布？

可信发布使用 OpenID Connect (OIDC) 协议，允许从 CI/CD 工作流直接发布包到 npm，无需在 GitHub Secrets 中存储长期有效的 `NPM_TOKEN`。

### 优势

✅ **更安全**：使用短期 OIDC 令牌，自动过期  
✅ **无需管理令牌**：不需要手动创建、轮换或撤销 npm 令牌  
✅ **自动生成 Provenance**：为公共包自动生成来源证明  
✅ **降低泄露风险**：令牌不会在日志或配置文件中暴露

## 配置步骤

### 1. 在 npmjs.com 上配置可信发布者

对于 Zhin 项目中的**每个需要发布的包**，你需要在 npmjs.com 上配置可信发布者：

#### 需要配置的包列表

以下是需要配置的所有包（根据 workspace 配置）：

**核心包 (packages/)**
- `zhin.js`
- `@zhin.js/core`
- `@zhin.js/client`
- `@zhin.js/create-zhin`

**基础包 (basic/)**
- `@zhin.js/cli`
- `@zhin.js/database`
- `@zhin.js/dependency`
- `@zhin.js/hmr`
- `@zhin.js/logger`
- `@zhin.js/schema`
- `@zhin.js/types`

**适配器 (plugins/adapters/)**
- `@zhin.js/adapter-dingtalk`
- `@zhin.js/adapter-discord`
- `@zhin.js/adapter-email`
- `@zhin.js/adapter-icqq`
- `@zhin.js/adapter-kook`
- `@zhin.js/adapter-lark`
- `@zhin.js/adapter-onebot11`
- `@zhin.js/adapter-qq`
- `@zhin.js/adapter-sandbox`
- `@zhin.js/adapter-slack`
- `@zhin.js/adapter-telegram`
- `@zhin.js/adapter-wechat-mp`

**服务插件 (plugins/services/)**
- `@zhin.js/console`
- `@zhin.js/plugin-github-notify`
- `@zhin.js/http`
- `@zhin.js/mcp`

**工具插件 (plugins/utils/)**
- `@zhin.js/plugin-music`
- `@zhin.js/plugin-sensitive-filter`

#### 配置步骤（针对每个包）

1. **登录 npmjs.com**  
   访问 https://www.npmjs.com 并登录你的账户

2. **进入包设置**  
   导航到包页面，点击 **Settings** → **Publishing access**

3. **添加可信发布者**  
   点击 **"Add a trusted publisher"**

4. **配置 GitHub Actions**  
   填写以下信息：
   
   - **Provider**: 选择 `GitHub Actions`
   - **Repository owner**: `zhinjs`
   - **Repository name**: `zhin`
   - **Workflow filename**: `publish.yml`  
     ⚠️ **重要**：必须包含 `.yml` 扩展名
   - **Environment name**: 留空（可选）

5. **保存配置**  
   点击 **"Add trusted publisher"** 保存

6. **（推荐）限制令牌访问**  
   配置完成后，建议限制传统令牌访问：
   
   - 在 **Publishing access** 页面
   - 选择 **"Require two-factor authentication and disallow tokens"**
   - 点击 **"Update Package Settings"**
   
   这样可以确保只能通过可信发布来发布包，进一步提高安全性。

### 2. GitHub Actions 配置

✅ **已完成**！工作流文件 `.github/workflows/publish.yml` 已配置好：

- ✅ 添加了 `id-token: write` 权限
- ✅ 配置了 `registry-url: 'https://registry.npmjs.org'`
- ✅ 移除了 `NODE_AUTH_TOKEN` 环境变量（使用 OIDC 自动认证）

### 3. 触发发布

配置完成后，有两种方式触发发布：

#### 方式 1：推送标签（自动）

```bash
# 创建并推送标签
git tag v2.0.0
git push origin v2.0.0
```

#### 方式 2：手动触发

1. 访问 GitHub Actions 页面
2. 选择 **"Publish to npm"** 工作流
3. 点击 **"Run workflow"**
4. 输入标签名称（如 `v2.0.0`）

## 自动 Provenance 生成

使用可信发布时，npm 会**自动**为你的公共包生成 Provenance（来源证明），无需添加 `--provenance` 参数。

Provenance 提供：
- 📦 包的构建来源证明
- 🔐 加密签名验证
- 🔍 可追溯的构建历史

用户可以通过以下方式验证：

```bash
npm view <package-name> --json | jq .dist.attestations
```

### 禁用 Provenance（不推荐）

如果需要禁用，可以在 `package.json` 中添加：

```json
{
  "publishConfig": {
    "provenance": false
  }
}
```

## 安全最佳实践

### ✅ 推荐做法

1. **优先使用可信发布**  
   对所有包启用可信发布，避免使用长期令牌

2. **限制令牌访问**  
   配置 "disallow tokens" 选项，强制使用可信发布

3. **定期审计**  
   定期检查 npmjs.com 上的可信发布配置

4. **使用标签保护**  
   在 GitHub 仓库设置中配置标签保护规则

5. **审查发布日志**  
   每次发布后检查 GitHub Actions 日志

### ❌ 避免做法

1. ❌ 不要在代码中硬编码 npm 令牌
2. ❌ 不要在公共日志中暴露令牌
3. ❌ 不要使用过于宽泛的权限
4. ❌ 不要跳过测试步骤直接发布

## 处理私有依赖

如果你的包依赖私有 npm 包，可信发布只处理 `npm publish` 操作。安装私有依赖时仍需要令牌：

```yaml
- name: Install dependencies
  run: pnpm install
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_READ_TOKEN }}

- name: Publish to npm
  run: pnpm pub
  # OIDC 自动处理发布认证
```

**建议**：为安装依赖使用**只读**的细粒度访问令牌（Granular Access Token）。

## 故障排查

### 错误：Unable to authenticate

**可能原因**：
1. 工作流文件名不匹配（必须是 `publish.yml`，包含 `.yml` 扩展名）
2. 仓库所有者或名称配置错误
3. 包未配置可信发布者
4. 使用了自托管 runner（当前不支持）

**解决方法**：
- 仔细检查 npmjs.com 上的配置是否与仓库信息完全匹配
- 确认使用的是 GitHub 托管的 runner
- 检查工作流中是否有 `id-token: write` 权限

### 错误：Provenance generation failed

**可能原因**：
1. 仓库是私有的（私有仓库不支持 Provenance）
2. 包是私有的（私有包不支持 Provenance）

**解决方法**：
- 对于私有仓库，Provenance 会被自动跳过
- 如需禁用 Provenance，在 `package.json` 中设置 `provenance: false`

### 安装依赖时认证失败

**可能原因**：
可信发布只适用于 `npm publish`，不适用于 `npm install`

**解决方法**：
如果有私有依赖，在 install 步骤添加 `NODE_AUTH_TOKEN`：

```yaml
- name: Install dependencies
  run: pnpm install
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_READ_TOKEN }}
```

## 迁移清单

从传统令牌迁移到可信发布的步骤：

- [ ] 1. 为所有包在 npmjs.com 上配置可信发布者
- [ ] 2. 测试发布流程（可以先用一个测试包）
- [ ] 3. 验证 Provenance 是否正确生成
- [ ] 4. 在 npmjs.com 上启用 "disallow tokens"
- [ ] 5. 撤销旧的自动化令牌（如果有）
- [ ] 6. 更新团队文档和发布流程

## 限制和未来改进

- ⚠️ 当前不支持自托管 runner
- ⚠️ 每个包只能配置一个可信发布者
- ⚠️ OIDC 认证仅适用于 `npm publish`，其他命令仍需传统认证

## 参考资料

- 📖 [npm 可信发布官方文档](https://docs.npmjs.com/trusted-publishers)
- 📖 [GitHub Actions OIDC 文档](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- 📖 [npm Provenance 文档](https://docs.npmjs.com/generating-provenance-statements)
- 📖 [OpenSSF 可信发布规范](https://github.com/ossf/wg-securing-software-repos/blob/main/docs/publishing-workflow.md)

## 支持

如有问题，请：
1. 查看 GitHub Actions 工作流日志
2. 检查 npmjs.com 上的配置
3. 在项目中提 Issue

