# 微信公众号适配器部署指南

本适配器由 Zhin Runtime Host 承载 HTTP Webhook。适配器不会直接读取环境变量；
`zhin.config.yml` 负责把环境变量引用解析为每个 endpoint 的完整配置。

## 前置条件

- Node.js `^20.19.0` 或 `>=22.12.0`
- 一个可公网访问的 HTTPS 域名
- 微信公众号的 AppID、AppSecret、回调 Token
- 安装 `@zhin.js/adapter-wechat-mp`

## 配置

在项目 `.env` 中保存凭据：

```dotenv
WECHAT_APP_ID=your-wechat-app-id
WECHAT_APP_SECRET=your-app-secret
WECHAT_TOKEN=your-callback-token
WECHAT_ENCODING_AES_KEY=your-encoding-aes-key
HTTP_TOKEN=your-runtime-http-token
```

在 `zhin.config.yml` 中显式引用这些值：

```yaml
http:
  port: 3000
  token: "${HTTP_TOKEN}"

plugins:
  wechat-mp:
    path: /wechat/webhook
    endpoints:
      - id: wechat-mp-bot
        appId: "${WECHAT_APP_ID}"
        appSecret: "${WECHAT_APP_SECRET}"
        token: "${WECHAT_TOKEN}"
        encodingAESKey: "${WECHAT_ENCODING_AES_KEY}"
        encryptMode: compatible
```

实例级 `path`、`encryptMode`、`replyMode` 和 `passiveReplyTimeoutMs` 会由
AdapterIndex 合并进每个 endpoint；每个 endpoint 也可以显式覆盖这些字段。

## 启动

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm exec zhin runtime start --mode production --no-watch
```

运行时 HTTP Host 监听 `3000` 端口后，适配器会注册 `/wechat/webhook` 的 GET 和
POST 路由。生产环境应由 Nginx、Caddy 或云负载均衡器终止 TLS，再把该路径转发到
Runtime Host。

Nginx 示例：

```nginx
location /wechat/webhook {
    proxy_pass http://127.0.0.1:3000/wechat/webhook;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_send_timeout 5s;
    proxy_read_timeout 5s;
}
```

## 微信公众平台

在「开发 → 基本配置」中填写：

- URL：`https://your-domain.example/wechat/webhook`
- Token：与 endpoint 的 `token` 一致
- EncodingAESKey：与 endpoint 的 `encodingAESKey` 一致
- 消息加解密方式：与 `encryptMode` 一致

提交配置时，微信会发起 GET 验签。验签失败时依次检查公网路由、Token、
EncodingAESKey、反向代理路径和 Runtime Host 日志。

## 容器部署

容器中仍需同时提供配置文件和它引用的环境变量。凭据环境变量只是配置输入，协议层
不会自行读取或补齐它们。健康检查应指向你的 Runtime Host readiness 路由，具体模板见
仓库 `docs/public/deploy/production/`。
