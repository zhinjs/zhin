# HMR 模块待发布更新

## [Unreleased]

### 🔥 重要修复

#### 防止监听 node_modules 导致服务器卡死

**问题描述：**
在之前的版本中，如果在配置中的 `plugin_dirs` 包含 `node_modules`，HMR 系统会递归监听整个 node_modules 目录（通常包含数万个文件），导致：
- Linux 服务器 inotify 资源耗尽
- CPU 和内存占用过高
- 服务器响应缓慢甚至完全卡死

**修复方案：**
- FileWatcher 构造函数现在会自动过滤掉包含 `node_modules` 的路径
- 当检测到 node_modules 路径时会发出警告日志
- 建议用户仅在 `plugin_dirs` 中配置实际的插件目录

**影响的配置：**
```typescript
// ❌ 之前这样配置会导致问题
plugin_dirs: ['node_modules', 'node_modules/@zhin.js']

// ✅ 现在会自动跳过，并显示警告
// 建议改为：
plugin_dirs: ['./plugins']
```

**迁移指南：**
1. 检查你的 `zhin.config.*` 文件
2. 移除 `plugin_dirs` 中的 `node_modules` 相关配置
3. 仅保留实际的插件目录路径
4. 运行 `pnpm check:prod` 检查配置

**相关文档：**
- [生产环境部署指南](../../docs/guide/production-deployment.md)
- [安全政策 - 文件监听性能](../../SECURITY.md)

### 📝 文档更新

- 添加生产环境部署完整指南
- 更新 SECURITY.md 添加文件监听性能建议
- 在 README.md 中添加警告提示
- 创建配置检查脚本 `scripts/check-production-config.js`

### 🛠️ 改进

- FileWatcher 现在会记录警告日志帮助识别问题
- 添加 `pnpm check:prod` 命令用于部署前检查配置

---

**发布日期：** 待定
**向后兼容性：** 是（自动跳过 node_modules，不会破坏现有功能）
**需要迁移：** 建议更新配置文件以避免警告日志

