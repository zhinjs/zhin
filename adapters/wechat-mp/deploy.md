# 微信公众号适配器部署指南

## 环境要求

- Node.js >= 16.0.0
- npm 或 pnpm
- 可访问的域名或公网IP
- SSL证书（推荐，微信要求HTTPS）
- `@zhin.js/http` 插件（必须）

## 部署步骤

### 1. 环境准备

```bash
# 克隆项目
git clone https://github.com/zhinjs/zhin-next
cd zhin-next/adapters/wechat-mp

# 安装依赖
pnpm install

# 构建项目
pnpm build
```

### 2. 环境变量配置

创建 `.env` 文件：

```bash
# 微信公众号配置
WECHAT_APP_ID=wx1234567890abcdef
WECHAT_APP_SECRET=your-app-secret-key
WECHAT_TOKEN=your-verification-token
WECHAT_ENCODING_AES_KEY=your-encoding-aes-key
WECHAT_WEBHOOK_PATH=/wechat

# HTTP 服务器配置
HTTP_PORT=3000
NODE_ENV=production
```

### 3. PM2 部署配置

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [{
    name: 'wechat-mp-bot',
    script: './example.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }],

  deploy: {
    production: {
      user: 'node',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'https://github.com/zhinjs/zhin-next',
      path: '/var/www/wechat-mp-bot',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
}
```

### 4. Nginx 反向代理配置

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com;
    
    # 强制HTTPS重定向
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.com;
    
    # SSL证书配置
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_stapling on;
    ssl_stapling_verify on;
    
    # 代理到 zhin-next HTTP 服务
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 微信验证需要较快响应
        proxy_connect_timeout 5s;
        proxy_send_timeout 5s;
        proxy_read_timeout 5s;
    }
    
    # 特别处理微信webhook（如果需要特殊配置）
    location /wechat {
        proxy_pass http://localhost:3000/wechat;
        # 同上面的代理配置...
    }
}
```

### 5. Docker 部署

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 复制package文件
COPY package*.json ./
COPY pnpm-lock.yaml ./

# 安装依赖
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 构建项目
RUN pnpm build

    # 暴露端口 (HTTP 插件端口)
    EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# 启动应用
CMD ["node", "lib/example.js"]
```

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  zhin-bot:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - WECHAT_APP_ID=${WECHAT_APP_ID}
      - WECHAT_APP_SECRET=${WECHAT_APP_SECRET}
      - WECHAT_TOKEN=${WECHAT_TOKEN}
      - HTTP_PORT=3000
    restart: unless-stopped
    volumes:
      - ./logs:/app/logs
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - zhin-bot
    restart: unless-stopped
```

### 6. 微信公众平台配置

1. 登录微信公众平台：https://mp.weixin.qq.com/
2. 进入「开发」->「基本配置」
3. 配置服务器地址：
   ```
   URL: https://your-domain.com/wechat
   Token: 与代码中配置的token一致
   EncodingAESKey: 随机生成或自定义
   消息加解密方式: 选择明文模式（推荐）
   ```
4. 点击「提交」进行验证

### 7. 启动服务

#### 使用PM2：
```bash
# 安装PM2
npm install -g pm2

# 启动应用
pm2 start ecosystem.config.js --env production

# 查看状态
pm2 status

# 查看日志
pm2 logs wechat-mp-bot
```

#### 使用Docker：
```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 8. 监控和日志

#### 日志配置

在应用中添加日志记录：

```javascript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'wechat-mp-bot' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}
```

#### 监控告警

可以集成以下监控服务：
- **Grafana + Prometheus**: 性能监控
- **Sentry**: 错误追踪
- **Uptime Robot**: 服务可用性监控

### 9. 安全建议

1. **环境变量管理**: 使用 `.env` 文件，不要将敏感信息提交到版本控制
2. **HTTPS**: 生产环境必须使用HTTPS
3. **防火墙**: 只开放必要的端口
4. **日志安全**: 不要在日志中记录敏感信息
5. **定期更新**: 及时更新依赖包和系统补丁

### 10. 故障排除

#### 常见问题：

1. **微信验证失败**:
   - 检查token是否一致
   - 确认URL可以访问
   - 查看服务器日志

2. **消息接收异常**:
   - 检查防火墙设置
   - 验证nginx配置
   - 查看应用日志

3. **Token过期**:
   - 检查access_token刷新逻辑
   - 查看微信API调用日志

#### 调试命令：

```bash
# 检查服务状态
pm2 status

# 实时查看日志
pm2 logs --lines 100

# 重启服务
pm2 restart wechat-mp-bot

# 检查端口占用
netstat -tulpn | grep 3000

# 测试webhook连接
curl -X POST https://your-domain.com/wechat
```

### 11. 性能优化

1. **负载均衡**: 使用多个实例
2. **缓存**: Redis缓存access_token
3. **数据库**: 消息持久化存储
4. **CDN**: 静态资源加速

### 12. 备份策略

1. **代码备份**: Git版本控制
2. **配置备份**: 定期备份配置文件
3. **日志备份**: 日志轮转和归档
4. **数据备份**: 定期备份数据库

通过以上步骤，您的微信公众号机器人就可以稳定运行在生产环境中了！
