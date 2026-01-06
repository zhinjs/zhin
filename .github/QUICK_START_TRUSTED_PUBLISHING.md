# 🚀 npm 可信发布快速开始

## 📋 配置清单

### 第一步：在 npmjs.com 上配置（必须）

为以下 **27 个包**配置可信发布者：

```bash
# 查看完整包列表
node scripts/list-packages-for-trusted-publishing.mjs
```

#### 配置模板（每个包都需要）

1. 访问：`https://www.npmjs.com/package/<包名>/settings`
2. 点击：**Publishing access** → **Add a trusted publisher**
3. 填写：

| 字段 | 值 |
|------|-----|
| Provider | `GitHub Actions` |
| Repository owner | `zhinjs` |
| Repository name | `zhin` |
| Workflow filename | `publish.yml` ⚠️ 必须包含 `.yml` |
| Environment name | (留空) |

4. 保存后，建议启用：**"Require 2FA and disallow tokens"**

### 第二步：GitHub Actions 配置（已完成 ✅）

- ✅ 工作流文件已创建：`.github/workflows/publish.yml`
- ✅ CI 工作流已更新：`.github/workflows/ci.yml`
- ✅ 添加了 `id-token: write` 权限
- ✅ 配置了 npm registry URL
- ✅ 移除了 `NODE_AUTH_TOKEN` 依赖

### 第三步：触发发布

#### 方式 1：推送标签（推荐）

```bash
# 创建标签
git tag v2.0.0

# 推送标签（自动触发发布）
git push origin v2.0.0
```

#### 方式 2：手动触发

1. 访问：https://github.com/zhinjs/zhin/actions
2. 选择：**Publish to npm**
3. 点击：**Run workflow**
4. 输入：标签名（如 `v2.0.0`）

## 🎯 核心包列表（优先配置）

| 包名 | npm URL |
|------|---------|
| `zhin.js` | https://www.npmjs.com/package/zhin.js |
| `@zhin.js/core` | https://www.npmjs.com/package/@zhin.js/core |
| `@zhin.js/client` | https://www.npmjs.com/package/@zhin.js/client |
| `create-zhin-app` | https://www.npmjs.com/package/create-zhin-app |

## 📦 所有包分类

### 核心包 (4)
- `zhin.js`
- `@zhin.js/core`
- `@zhin.js/client`
- `create-zhin-app`

### 基础包 (5)
- `@zhin.js/cli`
- `@zhin.js/database`
- `@zhin.js/dependency`
- `@zhin.js/logger`
- `@zhin.js/schema`

### 适配器 (12)
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

### 服务插件 (4)
- `@zhin.js/console`
- `@zhin.js/plugin-github-notify`
- `@zhin.js/http`
- `@zhin.js/mcp`

### 工具插件 (2)
- `@zhin.js/plugin-music`
- `@zhin.js/sensitive-filter`

## ✅ 验证配置

### 1. 检查 npmjs.com 配置

访问每个包的设置页面，确认：
- ✅ Trusted publisher 显示为 `zhinjs/zhin` (GitHub Actions)
- ✅ Workflow 显示为 `publish.yml`

### 2. 测试发布流程

建议先用一个测试包验证：

```bash
# 1. 确保所有测试通过
pnpm test

# 2. 构建所有包
pnpm build

# 3. 创建测试标签
git tag v2.0.0-test

# 4. 推送并观察 Actions
git push origin v2.0.0-test

# 5. 检查 Actions 日志
# 访问：https://github.com/zhinjs/zhin/actions
```

### 3. 验证 Provenance

发布成功后，检查 Provenance：

```bash
npm view zhin.js --json | jq .dist.attestations
```

应该看到类似输出：
```json
{
  "url": "https://registry.npmjs.org/-/npm/v1/attestations/...",
  "provenance": {
    "predicateType": "https://slsa.dev/provenance/v1"
  }
}
```

## 🔧 故障排查

### ❌ 错误：Unable to authenticate

**原因**：npmjs.com 上未配置或配置错误

**解决**：
1. 检查包名是否正确
2. 确认 workflow 文件名为 `publish.yml`（包含 `.yml`）
3. 验证仓库信息：`zhinjs/zhin`

### ❌ 错误：Workflow not found

**原因**：工作流文件名不匹配

**解决**：
- npmjs.com 上配置的必须是 `publish.yml`
- 不能是 `publish.yaml` 或其他名称

### ❌ 错误：Permission denied

**原因**：缺少 OIDC 权限

**解决**：
检查工作流文件中是否有：
```yaml
permissions:
  id-token: write
  contents: read
```

### ⚠️ 警告：Provenance not generated

**说明**：
- 私有仓库不支持 Provenance（正常）
- 私有包不支持 Provenance（正常）
- 不影响发布功能

## 📚 详细文档

- 📖 [完整配置指南](.github/TRUSTED_PUBLISHING_SETUP.md)
- 📖 [工作流说明](.github/workflows/README.md)
- 📖 [npm 官方文档](https://docs.npmjs.com/trusted-publishers)

## 🎉 配置完成后的优势

- 🔒 **更安全**：无需管理长期令牌
- ⚡ **更快速**：自动化发布流程
- 📝 **可追溯**：自动生成 Provenance
- 🛡️ **更可靠**：降低令牌泄露风险

## 💡 提示

1. **批量配置**：建议使用脚本输出的 CSV 格式，方便批量处理
2. **优先级**：先配置核心包，再配置其他包
3. **测试**：配置完成后先用测试标签验证
4. **监控**：首次发布时密切关注 Actions 日志
5. **文档**：保存配置记录，方便团队成员查阅

---

**需要帮助？** 查看 [详细配置指南](.github/TRUSTED_PUBLISHING_SETUP.md) 或在项目中提 Issue。

