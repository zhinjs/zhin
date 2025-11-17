# 🌐 Zhin.js 插件生态系统

## 📦 插件分发与发现

### 插件命名规范

为了让用户能够轻松找到和识别 Zhin.js 插件，我们制定了以下命名规范：

#### 官方插件
```
@zhin.js/[plugin-name]

示例：
- @zhin.js/http
- @zhin.js/console
- @zhin.js/adapter-icqq
```

#### 社区插件（推荐）
```
zhin.js-[plugin-name]

示例：
- zhin.js-chatgpt
- zhin.js-music
- zhin.js-admin
```

### package.json 配置

所有插件应在 `package.json` 中包含以下字段：

```json
{
  "name": "zhin.js-plugin-example",
  "version": "1.0.0",
  "description": "示例插件描述",
  "keywords": [
    "zhin.js",
    "plugin",
    "chatbot",
    "相关关键词"
  ],
  "zhin": {
    "type": "plugin",
    "category": "utility",
    "features": ["命令", "中间件"],
    "displayName": "示例插件",
    "icon": "🔧",
    "homepage": "https://github.com/username/zhin.js-example"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/username/zhin.js-example"
  },
  "bugs": {
    "url": "https://github.com/username/zhin.js-example/issues"
  }
}
```

### 插件分类

- **utility** - 工具类
- **service** - 服务类
- **game** - 游戏娱乐
- **adapter** - 平台适配器
- **admin** - 管理工具
- **ai** - AI 相关

## 🔍 插件发现

### 方式 1：npm 搜索

用户可以通过 npm 搜索找到插件：

```bash
# 搜索所有 Zhin.js 插件
npm search zhin.js plugin

# 搜索特定功能插件
npm search zhin.js plugin chatgpt
```

### 方式 2：CLI 搜索命令

```bash
# 搜索插件
zhin search chatgpt

# 按分类搜索
zhin search --category game

# 查看插件详情
zhin info zhin.js-chatgpt
```

### 方式 3：官方插件市场

访问官方网站查看完整的插件列表：
- 网站：https://zhin.pages.dev/plugins
- GitHub Topic：https://github.com/topics/zhin.js

## 📤 发布插件

### 1. 准备插件

确保你的插件包含：
- ✅ 清晰的 README.md
- ✅ 完整的 package.json 配置
- ✅ 关键词标签（keywords）
- ✅ 构建产物（lib/ 目录）
- ✅ TypeScript 类型定义

### 2. 发布到 npm

```bash
# 使用 CLI 发布
zhin pub my-plugin

# 或使用 pnpm 发布
pnpm publish --access public
```

### 3. 提交到插件市场

发布后，你可以：

1. **在 GitHub 添加 topic**：
   - 打开你的 GitHub 仓库
   - 点击 "About" → "Settings"
   - 添加 topics：`plugin`, `zhin`, `chatbot`

2. **提交到官方插件列表**：
   - Fork https://github.com/zhinjs/awesome
   - 在 `plugins.yml` 中添加你的插件信息
   - 提交 Pull Request

3. **在社区分享**：
   - Zhin.js Discord 服务器
   - GitHub Discussions
   - 社交媒体

## 🎯 插件质量标准

为了保证插件质量，推荐遵循以下标准：

### 基础要求
- ✅ 包含详细的使用文档
- ✅ 提供配置选项和示例
- ✅ 使用 TypeScript 并提供类型定义
- ✅ 遵循语义化版本规范
- ✅ 包含 CHANGELOG.md

### 推荐实践
- ✅ 编写单元测试
- ✅ 提供配置 Schema
- ✅ 支持热重载
- ✅ 处理错误情况
- ✅ 添加日志记录
- ✅ 文档齐全（API、示例）

### 高质量插件
- ✅ 提供 Web 控制台界面
- ✅ 支持国际化
- ✅ 性能优化
- ✅ 完整的测试覆盖
- ✅ CI/CD 自动化
- ✅ 详细的贡献指南

## 🏆 官方认证

优秀的社区插件可以申请官方认证：

### 认证标准
1. 代码质量高
2. 文档完善
3. 活跃维护
4. 用户反馈良好
5. 遵循最佳实践

### 认证流程
1. 发布插件并在社区使用 3 个月以上
2. 在 GitHub 上提交认证申请 Issue
3. 官方团队审核
4. 通过后获得 ✨ 认证标识

### 认证权益
- ✨ 在插件市场显示认证标识
- 📢 官方社交媒体推广
- 📚 收录到官方文档
- 🎯 优先技术支持

## 📊 插件市场数据

插件市场会展示：
- 📈 下载量
- ⭐ GitHub Stars
- 📝 最后更新时间
- 🏷️ 版本信息
- 👥 作者信息
- 📦 依赖关系
- 🐛 已知问题数量

## 🔐 安全性

### 安装前检查
- 查看插件源码（GitHub）
- 检查下载量和 Stars
- 查看 Issues 和 Pull Requests
- 阅读用户评价

### 安全建议
- 优先使用官方插件
- 选择认证插件
- 检查插件权限
- 定期更新插件
- 报告安全问题

## 🤝 贡献插件

### 插件开发流程

1. **创建插件**
```bash
zhin new my-plugin
cd plugins/my-plugin
```

2. **开发插件**
```bash
pnpm dev  # 开发模式
```

3. **测试插件**
```bash
pnpm test
```

4. **构建插件**
```bash
pnpm build
```

5. **发布插件**
```bash
zhin pub my-plugin
```

6. **推广插件**
- 完善 README
- 添加示例和截图
- 分享到社区

## 🌟 优秀插件示例

### 官方插件
- `@zhin.js/http` - HTTP 服务器
- `@zhin.js/console` - Web 控制台
- `@zhin.js/adapter-icqq` - QQ 适配器

### 社区插件（示例）
- `zhin.js-chatgpt` - ChatGPT 集成
- `zhin.js-music` - 音乐点播
- `zhin.js-admin` - 管理工具
- `zhin.js-game-dice` - 骰子游戏

## 📚 相关资源

- 🏠 [官方网站](https://zhin.pages.dev)
- 📖 [插件开发指南](./plugin-development.md)
- 🔌 [插件市场](https://zhin.pages.dev/plugins)
- 💬 [Discord 社区](https://discord.gg/zhinjs)
- 📝 [GitHub Discussions](https://github.com/zhinjs/zhin/discussions)
- ⭐ [Awesome Zhin](https://github.com/zhinjs/awesome-zhin)

