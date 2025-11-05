# 生产环境部署指南

本指南帮助您安全、高效地将 Zhin.js 应用部署到生产环境。

## 🚨 关键问题：文件监听导致服务器卡死

### 问题描述

在默认配置下，Zhin.js 的热重载系统会监听 `plugin_dirs` 中配置的所有目录。如果配置了 `node_modules`，将导致：

- **监听大量文件**：node_modules 通常包含数万个文件（示例：21,876 个 JS/TS 文件）
- **资源耗尽**：Linux 服务器的 inotify 监听器数量有限
- **服务器卡死**：大量文件监听占用 CPU 和内存，导致系统响应缓慢甚至崩溃

### 解决方案

#### 1. **修改配置文件（推荐）**

不要在生产环境的 `plugin_dirs` 中包含 `node_modules`：

```typescript
// zhin.config.ts
export default defineConfig({
  plugin_dirs: [
    './src/plugins',           // ✅ 仅监听项目插件
    './plugins',               // ✅ 自定义插件目录
    // 'node_modules',         // ❌ 移除此配置
    // 'node_modules/@zhin.js' // ❌ 也要移除
  ],
  
  // 其他配置...
})
```

#### 2. **使用环境变量区分配置**

创建不同环境的配置：

```typescript
// zhin.config.ts
export default defineConfig(async () => {
  const isDev = process.env.NODE_ENV !== 'production';
  
  return {
    debug: isDev,
    
    plugin_dirs: isDev 
      ? ['./src/plugins', 'node_modules']  // 开发环境可以监听
      : ['./plugins'],                      // 生产环境仅监听必要目录
    
    plugins: [
      'http',
      'adapter-process',
      // 其他插件...
    ],
    
    // 其他配置...
  };
});
```

启动命令：

```bash
# 开发环境
NODE_ENV=development pnpm dev

# 生产环境
NODE_ENV=production pnpm start
```

#### 3. **调整系统 inotify 限制（临时方案）**

如果必须监听大量文件，可以增加系统限制（仅限 Linux）：

```bash
# 查看当前限制
cat /proc/sys/fs/inotify/max_user_watches

# 临时增加限制（重启后失效）
sudo sysctl fs.inotify.max_user_watches=524288

# 永久修改（添加到 /etc/sysctl.conf）
echo "fs.inotify.max_user_watches=524288" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

⚠️ **注意**：这只是临时方案，根本解决办法是避免监听 node_modules。

## 📋 生产环境检查清单

### 1. 配置优化

- [ ] 移除 `plugin_dirs` 中的 `node_modules`
- [ ] 设置 `debug: false`
- [ ] 配置合适的 `log_level`（建议 `warn` 或 `error`）
- [ ] 禁用不需要的插件
- [ ] 使用环境变量管理敏感信息

示例配置：

```typescript
export default defineConfig({
  log_level: LogLevel.WARN,
  debug: false,
  
  plugin_dirs: [
    './plugins'  // 仅加载生产插件
  ],
  
  plugins: [
    'http',
    'adapter-process',
    'adapter-icqq',
    // 只启用必要的插件
  ],
  
  http: {
    port: process.env.PORT || 8086,
    username: process.env.HTTP_USERNAME,
    password: process.env.HTTP_PASSWORD,
  },
  
  database: {
    dialect: 'sqlite',
    filename: process.env.DB_PATH || './data/bot.db'
  }
});
```

### 2. 安全配置

- [ ] 使用强密码保护 Web 控制台
- [ ] 限制 HTTP 服务访问（防火墙规则）
- [ ] 配置 HTTPS（使用反向代理）
- [ ] 定期更新依赖包
- [ ] 不要提交 `.env` 文件到版本控制

### 3. 性能优化

- [ ] 使用 PM2 或 systemd 管理进程
- [ ] 配置日志轮转（避免日志文件过大）
- [ ] 定期清理数据库（使用 `log.maxDays`）
- [ ] 监控内存和 CPU 使用率

### 4. 可靠性

- [ ] 配置进程守护（自动重启）
- [ ] 设置错误日志监控
- [ ] 配置数据库备份
- [ ] 准备回滚方案

## 🚀 部署方式

### 方式 1：使用 PM2（推荐）

安装 PM2：

```bash
npm install -g pm2
```

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [{
    name: 'zhin-bot',
    script: 'node_modules/.bin/zhin',
    args: 'start',
    env: {
      NODE_ENV: 'production',
      PORT: 8086
    },
    instances: 1,
    autorestart: true,
    watch: false,  // 重要：禁用 PM2 的文件监听
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
```

启动应用：

```bash
# 启动
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs zhin-bot

# 停止
pm2 stop zhin-bot

# 重启
pm2 restart zhin-bot

# 开机自启
pm2 startup
pm2 save
```

### 方式 2：使用 systemd

创建服务文件 `/etc/systemd/system/zhin-bot.service`：

```ini
[Unit]
Description=Zhin Bot Service
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/your/bot
Environment=NODE_ENV=production
ExecStart=/usr/bin/pnpm start
Restart=always
RestartSec=10

# 限制资源使用
MemoryLimit=1G
CPUQuota=50%

# 日志
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

管理服务：

```bash
# 启动服务
sudo systemctl start zhin-bot

# 开机自启
sudo systemctl enable zhin-bot

# 查看状态
sudo systemctl status zhin-bot

# 查看日志
sudo journalctl -u zhin-bot -f
```

### 方式 3：使用 Docker

创建 `Dockerfile`：

```dockerfile
FROM node:20-alpine

# 安装 pnpm
RUN npm install -g pnpm

WORKDIR /app

# 复制依赖配置
COPY package.json pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --prod

# 复制应用代码
COPY . .

# 构建应用
RUN pnpm build

# 设置环境变量
ENV NODE_ENV=production

# 暴露端口
EXPOSE 8086

# 启动应用
CMD ["pnpm", "start"]
```

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  zhin-bot:
    build: .
    ports:
      - "8086:8086"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
    mem_limit: 1g
    cpus: 0.5
```

运行：

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down
```

## 📊 监控和维护

### 日志管理

配置日志轮转：

```typescript
export default defineConfig({
  log: {
    maxDays: 7,        // 保留 7 天日志
    maxRecords: 10000, // 最多 10000 条记录
    cleanupInterval: 24 // 每 24 小时清理一次
  }
});
```

### 性能监控

使用 PM2 监控：

```bash
# 实时监控
pm2 monit

# 查看详细信息
pm2 show zhin-bot
```

### 数据库维护

定期备份：

```bash
# SQLite 备份
cp data/bot.db data/backups/bot-$(date +%Y%m%d).db

# 自动备份脚本（crontab）
0 2 * * * cp /path/to/data/bot.db /path/to/backups/bot-$(date +\%Y\%m\%d).db
```

## 🔧 故障排查

### 问题：服务器卡死或响应缓慢

**原因**：监听了 node_modules 导致资源耗尽

**解决**：
1. 检查配置文件中的 `plugin_dirs`
2. 移除 `node_modules` 相关配置
3. 重启应用

```bash
# 查看当前监听的文件数
lsof -p $(pgrep -f zhin) | wc -l

# 如果数量异常大（>1000），说明监听了过多文件
```

### 问题：内存占用过高

**解决**：
1. 配置内存限制（PM2 或 Docker）
2. 检查插件是否有内存泄漏
3. 定期重启应用

### 问题：启动失败

**检查**：
1. 环境变量是否正确配置
2. 数据库文件权限
3. 端口是否被占用
4. 查看详细日志

```bash
# 查看完整错误信息
NODE_ENV=production pnpm start 2>&1 | tee startup.log
```

## 🔐 安全建议

1. **使用反向代理**（Nginx/Caddy）

```nginx
# Nginx 配置示例
server {
    listen 80;
    server_name bot.example.com;

    location / {
        proxy_pass http://localhost:8086;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # 限制访问
        allow 192.168.1.0/24;  # 仅允许内网访问
        deny all;
    }
}
```

2. **配置 HTTPS**

```bash
# 使用 Certbot 获取免费证书
sudo certbot --nginx -d bot.example.com
```

3. **定期更新依赖**

```bash
# 检查安全漏洞
pnpm audit

# 更新依赖
pnpm update --latest
```

## 📚 相关文档

- [配置系统](./configuration.md)
- [安全政策](../../SECURITY.md)
- [最佳实践](./best-practices.md)
- [故障排查](./troubleshooting.md)

## 💡 最佳实践总结

1. ✅ **永远不要在生产环境监听 node_modules**
2. ✅ 使用环境变量区分开发和生产配置
3. ✅ 配置进程守护（PM2/systemd）
4. ✅ 限制资源使用（内存/CPU）
5. ✅ 配置日志轮转和清理
6. ✅ 使用反向代理和 HTTPS
7. ✅ 定期备份数据库
8. ✅ 监控应用性能和错误
9. ✅ 定期更新依赖包
10. ✅ 准备应急回滚方案

