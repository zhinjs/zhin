# 接入 钉钉 机器人
## 安装钉钉机器人适配器
```shell
npm install @zhinjs/adapter-dingtalk
```
## 准备钉钉机器人必要参数
### 1. 前往 [钉钉开放平台](https://open-dev.dingtalk.com/) 创建一个机器人，并记住 `appId` 和 `appSecret`

## 配置钉钉机器人适配器
### 1. 打开项目根目录下的 `config/zhin.config.yml` 文件
### 2. 在 `bots` 下添加以下配置
```yaml
bots:
  - adapter: dingtalk
    unique_id: 机器人唯一标识
    clientId: 你的appId
    clientSecret: 你的appSecret
    reconnect_interval: 3000 # 重连间隔(ms)
    max_reconnect_count: 10 # 最大重连次数
    heartbeat_interval: 3000 # 心跳间隔(ms)
    request_timeout: 5000 # 请求超时(ms)
    sandbox: true # 是否沙箱环境
```
## 启动 钉钉 机器人
- 保存配置文件后，执行以下命令启动机器人
```shell
npx zhin
```
