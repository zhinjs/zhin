# 首次发布包指南

本指南说明如何处理**从未发布到 npm 的包**，以便后续使用可信发布。

## 问题说明

⚠️ **npm 可信发布的限制**：只能为**已存在于 npm** 的包配置可信发布者。

对于从未发布的包（如 `@zhin.js/adapter-sandbox`），访问 npmjs.com 的包设置页面会显示 404 错误，无法配置可信发布者。

## 解决方案

### 方案 1：本地首次发布（推荐 ⭐）

最简单直接的方法，适合开发者本地操作。

#### 步骤：

```bash
# 1. 确保已登录 npm
npm whoami
# 如果未登录，运行：
npm login

# 2. 进入包目录
cd plugins/adapters/sandbox

# 3. 确保包已构建
pnpm build

# 4. 检查 package.json
cat package.json | grep -E "name|version|private"
# 确认：
# - name 正确
# - version 合理（建议从 0.1.0 或 1.0.0 开始）
# - private 不为 true

# 5. 首次发布
npm publish --access public

# 6. 验证发布成功
npm view @zhin.js/adapter-sandbox
```

#### 发布成功后：

立即在 npmjs.com 上配置可信发布者：

1. 访问：https://www.npmjs.com/package/@zhin.js/adapter-sandbox/access
2. 点击 **"Add a trusted publisher"**
3. 配置：
   - Provider: `GitHub Actions`
   - Repository owner: `zhinjs`
   - Repository name: `zhin`
   - Workflow filename: `publish.yml`
4. 保存并启用 **"Require 2FA and disallow tokens"**

### 方案 2：使用 GitHub Actions 首次发布

适合需要在 CI/CD 中完成首次发布的场景。

#### 前置条件：

需要在 GitHub Secrets 中配置 `NPM_TOKEN`：

1. 访问 https://www.npmjs.com/settings/YOUR_USERNAME/tokens
2. 创建新的 **Granular Access Token**：
   - Token name: `GitHub Actions First Publish`
   - Expiration: 30 days（首次发布后可删除）
   - Packages and scopes: 
     - Permissions: `Read and write`
     - Select packages: 选择要发布的包（或 All packages）
3. 复制生成的 token
4. 在 GitHub 仓库设置中添加 Secret：
   - Name: `NPM_TOKEN`
   - Value: 粘贴 token

#### 使用步骤：

1. 访问 GitHub Actions：https://github.com/zhinjs/zhin/actions
2. 选择 **"First Publish (for new packages)"** 工作流
3. 点击 **"Run workflow"**
4. 填写表单：
   - **Package name**: `@zhin.js/adapter-sandbox`
   - **Package path**: `plugins/adapters/sandbox`
5. 点击 **"Run workflow"** 开始发布
6. 等待工作流完成（查看日志）
7. 发布成功后，按照日志中的提示配置可信发布者

#### 发布后清理：

```bash
# 可选：首次发布完成并配置好可信发布者后，可以删除 NPM_TOKEN
# 1. 访问 GitHub 仓库 Settings → Secrets
# 2. 删除 NPM_TOKEN（后续使用可信发布，不再需要）
# 3. 在 npmjs.com 上撤销对应的 token
```

### 方案 3：批量首次发布

如果有多个未发布的包，可以使用脚本批量处理。

#### 创建批量发布脚本：

```bash
#!/bin/bash
# scripts/first-publish-batch.sh

# 未发布的包列表
PACKAGES=(
  "plugins/adapters/sandbox:@zhin.js/adapter-sandbox"
  # 添加其他未发布的包，格式：路径:包名
)

echo "🚀 开始批量首次发布..."
echo ""

for entry in "${PACKAGES[@]}"; do
  IFS=':' read -r path name <<< "$entry"
  
  echo "📦 发布 $name..."
  echo "   路径: $path"
  
  cd "$path" || exit 1
  
  # 构建
  pnpm build
  
  # 发布
  if npm publish --access public; then
    echo "✅ $name 发布成功！"
    echo "🔗 配置地址: https://www.npmjs.com/package/$name/access"
  else
    echo "❌ $name 发布失败！"
  fi
  
  echo ""
  cd - > /dev/null || exit 1
done

echo "✅ 批量发布完成！"
echo ""
echo "📋 下一步："
echo "为每个包配置可信发布者（访问上面的 🔗 配置地址）"
```

#### 使用：

```bash
chmod +x scripts/first-publish-batch.sh
./scripts/first-publish-batch.sh
```

## 常见问题

### Q1: 发布时提示 "You do not have permission to publish"

**原因**：
- 包名已被占用
- 没有对应 scope 的发布权限（如 `@zhin.js/`）

**解决**：
1. 检查包名是否正确
2. 确认你是 `@zhin.js` scope 的成员
3. 如果不是，联系 scope 所有者添加你为成员

### Q2: 发布时提示 "Package name too similar to existing package"

**原因**：npm 防止混淆攻击，拒绝相似的包名

**解决**：
- 更改包名，使其更具区分度
- 或联系 npm 支持

### Q3: 首次发布后无法立即配置可信发布者

**原因**：npm 缓存更新可能需要几分钟

**解决**：
- 等待 2-5 分钟后重试
- 清除浏览器缓存
- 使用无痕模式访问

### Q4: 是否必须使用可信发布？

**回答**：
- ❌ 不是必须的，传统的 `NPM_TOKEN` 方式仍然有效
- ✅ 但强烈推荐，因为更安全、更方便
- 🔒 可信发布是 npm 官方推荐的最佳实践

## 未发布包清单

当前项目中可能未发布的包：

| 包名 | 路径 | 状态 |
|------|------|------|
| `@zhin.js/adapter-sandbox` | `plugins/adapters/sandbox` | ⚠️ 未发布 |

运行以下命令查看最新列表：

```bash
node scripts/list-packages-for-trusted-publishing.mjs
```

## 最佳实践

1. **版本号选择**：
   - 新包建议从 `1.0.0` 开始（如果功能稳定）
   - 实验性包从 `0.1.0` 开始

2. **发布前检查**：
   ```bash
   # 检查包内容
   npm pack --dry-run
   
   # 查看将要发布的文件
   npm publish --dry-run
   ```

3. **立即配置可信发布**：
   - 首次发布成功后，立即配置可信发布者
   - 避免长期使用传统 token

4. **文档更新**：
   - 更新 README 添加安装说明
   - 更新 CHANGELOG 记录首次发布

5. **测试验证**：
   ```bash
   # 验证包可以正常安装
   npm install @zhin.js/adapter-sandbox
   
   # 查看包信息
   npm view @zhin.js/adapter-sandbox
   ```

## 后续步骤

首次发布并配置可信发布者后：

1. ✅ 后续发布将自动使用可信发布
2. ✅ 无需再使用 `NPM_TOKEN`
3. ✅ 自动生成 Provenance 证明
4. ✅ 更安全的发布流程

## 参考资料

- 📖 [npm publish 文档](https://docs.npmjs.com/cli/v10/commands/npm-publish)
- 📖 [npm 可信发布文档](https://docs.npmjs.com/trusted-publishers)
- 📖 [创建 npm token](https://docs.npmjs.com/creating-and-viewing-access-tokens)
- 📖 [Zhin 可信发布配置指南](./TRUSTED_PUBLISHING_SETUP.md)

---

**需要帮助？** 在项目中提 Issue 或查看详细文档。

