# @zhin.js/adapter-wecom

Zhin.js 企业微信（WeCom）适配器，支持企业内部应用机器人开发。

## 安装

```bash
pnpm add @zhin.js/adapter-wecom
```

## 前置条件

### 企业微信管理后台配置

1. **登录企业微信管理后台**
   - 访问 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
   - 使用管理员账号登录

2. **创建应用**
   - 进入「应用管理」→「自建」
   - 点击「创建应用」
   - 填写应用名称、上传 Logo、选择可见范围

3. **获取应用凭证**
   - 在应用详情页面获取：
     - **CorpId**（企业 ID）：在「我的企业」→「企业信息」中查看
     - **AgentId**（应用 AgentId）：在应用详情页面
     - **Secret**（应用 Secret）：在应用详情页面

4. **配置接收消息**
   - 在应用详情页面，进入「接收消息」设置
   - 设置 **URL**：`https://yourdomain.com/wecom/callback`
   - 设置 **Token**：自定义字符串（用于签名验证）
   - 设置 **EncodingAESKey**：点击「随机获取」（用于消息加解密）
   - 点击「保存」，企业微信会发送验证请求

5. **配置权限**
   - 在「API 权限」中申请所需权限：
     - `通讯录只读权限` - 读取组织架构和用户信息
     - `应用消息发送权限` - 向用户发送消息
     - 其他业务需要的权限

## 配置

### 基础配置（zhin.config.yml）

```yaml
endpoints:
  - name: wecom-bot
    context: wecom
    corpId: "ww1234567890abcdef"
    agentSecret: "your-agent-secret"
    token: "your-verify-token"
    encodingAESKey: "your-43-char-encoding-aes-key"
    webhookPath: "/wecom/callback"

plugins:
  - "@zhin.js/host-router"
  - "@zhin.js/adapter-wecom"
```

### 完整配置

```yaml
endpoints:
  - name: wecom-bot
    context: wecom
    corpId: "ww1234567890abcdef"
    agentSecret: "your-agent-secret"
    token: "your-verify-token"
    encodingAESKey: "your-43-char-encoding-aes-key"
    webhookPath: "/wecom/callback"
    apiBaseUrl: "https://qyapi.weixin.qq.com"  # 可选，默认值
```

### 配置参数说明

| 参数 | 必需 | 说明 |
|------|------|------|
| `corpId` | 是 | 企业 ID，在管理后台「我的企业」查看 |
| `agentSecret` | 是 | 应用 Secret，在应用详情页获取 |
| `token` | 是 | 用于签名验证，需与管理后台「接收消息」设置中的 Token 一致 |
| `encodingAESKey` | 是 | 用于消息加解密，需与管理后台一致（43 字符） |
| `webhookPath` | 否 | Webhook 回调路径，默认 `/wecom/callback` |
| `apiBaseUrl` | 否 | 企业微信 API 地址，默认 `https://qyapi.weixin.qq.com` |

### 环境变量推荐

```yaml
endpoints:
  - name: wecom-bot
    context: wecom
    corpId: "${WECOM_CORP_ID}"
    agentSecret: "${WECOM_AGENT_SECRET}"
    token: "${WECOM_TOKEN}"
    encodingAESKey: "${WECOM_AES_KEY}"
```

## 使用示例

### 接收和发送消息

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand, logger } = usePlugin()

// 定义命令
addCommand(new MessageCommand('hello <name:text>')
  .action(async (message, result) => {
    logger.info(`收到问候: ${result.params.name}`)
    return `你好，${result.params.name}！欢迎使用企业微信机器人。`
  })
)

// 监听所有消息
import { onMessage } from 'zhin.js'

onMessage(async (message) => {
  logger.info(`收到消息：${JSON.stringify(message.$content)}`)
  logger.info(`发送者：${message.$sender.name}`)
  logger.info(`会话类型：${message.$channel.type}`)
})
```

### 发送富文本消息

```typescript
addCommand(new MessageCommand('info')
  .action(async (message) => {
    return [
      {
        type: 'markdown',
        data: {
          content: `# 系统信息\n\n- 服务器: 运行正常\n- 版本: v1.0.0\n- 状态: 在线`
        }
      }
    ]
  })
)
```

## 消息类型支持

### 接收消息类型

| 类型 | 状态 | 说明 |
|------|------|------|
| 文本消息 (`text`) | 支持 | 普通文本 |
| 图片消息 (`image`) | 支持 | 图片文件 |
| 语音消息 (`voice`) | 支持 | 含语音识别结果 |
| 视频消息 (`video`) | 支持 | 视频文件 |
| 位置消息 (`location`) | 支持 | 地理位置 |
| 链接消息 (`link`) | 支持 | 链接卡片 |
| 事件消息 (`event`) | 支持 | 关注/取消关注等 |

### 发送消息类型

| 类型 | 状态 | 说明 |
|------|------|------|
| 文本消息 | 支持 | 支持 @ 提醒 |
| 图片消息 | 支持 | 需要 media_id |
| Markdown 消息 | 支持 | 企业微信原生 Markdown |
| 图文消息 | 支持 | news 类型 |
| 撤回消息 | 不支持 | 企业微信机器人不支持撤回 |

## 安全说明

### 消息加解密

企业微信使用 AES-256-CBC 加密算法对回调消息进行加密：

- **签名验证**：SHA1 排序拼接 `[token, timestamp, nonce, encrypt]`
- **解密流程**：
  1. Base64 解码加密消息
  2. AES-256-CBC 解密（Key: `encodingAESKey` + `=` 的 Base64 解码，IV: Key 的前 16 字节）
  3. PKCS7 去填充
  4. 提取：16 字节随机数 + 4 字节消息长度 + 消息体 + CorpId

适配器自动处理所有加解密，无需手动处理。

### Token 管理

适配器会自动管理 access_token：
- 首次连接时获取 token
- Token 过期前 5 分钟自动刷新
- 所有 API 请求自动携带有效 token

## API 方法

### 获取用户信息

```typescript
const endpoint = app.adapters.get('wecom')?.endpoints.get('wecom-bot')
if (endpoint) {
  const userInfo = await endpoint.getUserInfo('user-id')
  console.log(userInfo)
}
```

### 获取部门用户列表

```typescript
const users = await endpoint.getDepartmentUsers(1) // 部门 ID
console.log(users)
```

### 获取部门列表

```typescript
const departments = await endpoint.getDepartmentList(1) // 父部门 ID
console.log(departments)
```

### 发送文本消息

```typescript
const success = await endpoint.sendTextMessage('user-id', '这是一条测试消息')
```

## 故障排查

### Q: Webhook 验证失败？

A: 检查以下几点：
1. `token` 是否与企业微信管理后台设置的 Token 一致
2. `encodingAESKey` 是否与管理后台一致（43 字符）
3. 服务器是否可从公网访问
4. 服务器是否返回了正确的验证响应（解密后的 echostr）

### Q: 收不到消息回调？

A: 可能的原因：
1. 应用未启用「接收消息」功能
2. Webhook URL 配置错误或不可达
3. 应用可见范围未包含发送消息的用户
4. 服务器日志中是否有签名验证失败的警告

### Q: 发送消息失败？

A: 可能的原因：
1. `agentSecret`（应用 Secret）配置错误
2. access_token 获取失败（检查 CorpId 和 Secret）
3. 接收者不在应用可见范围内
4. 应用未开通消息发送权限

### Q: Token 刷新失败？

A: 检查：
1. CorpId 是否正确
2. agentSecret 是否是应用 Secret（不是应用的 AgentId 数字）
3. 企业微信 API 是否可访问

## 相关链接

- [企业微信开发文档](https://developer.work.weixin.qq.com/document/)
- [企业微信接收消息](https://developer.work.weixin.qq.com/document/path/90930)
- [企业微信发送应用消息](https://developer.work.weixin.qq.com/document/path/90236)
- [Zhin.js 官方文档](https://github.com/zhinjs/zhin)

## 许可证

MIT License
