# 接入 Discord
## 安装 Discord 机器人适配器
```bash
npm install @zhinjs/adapter-discord
```
## 准备机器人必要参数
### 1. 前往 [Discord Developer Portal](https://discord.com/developers/applications) 创建一个机器人，并记住 `clientId` 和 `clientSecret`

## 配置 Discord 机器人适配器
### 1. 打开项目根目录下的 `config/zhin.config.yml` 文件
### 2. 在 `bots` 下添加以下配置
```yaml
bots:
  - adapter: discord
    unique_id: 机器人唯一标识
    clientId: 你的clientId
    clientSecret: 你的clientSecret
    reconnect_interval: 3000 # 重连间隔(ms)
    max_reconnect_count: 10 # 最大重连次数
    heartbeat_interval: 3000 # 心跳间隔(ms)
    request_timeout: 5000 # 请求超时(ms)
    sandbox: true # 是否沙箱环境
```
## 启动 Discord 机器人
- 保存配置文件后，执行以下命令启动机器人
```shell
npx zhin
```
