# 接入 QQ
## 安装 QQ 机器人适配器
```shell
npm install @zhinjs/adapter-qq
```
## 准备 QQ 机器人账号
### 1. 前往 [QQ 机器人平台](https://q.qq.com/) 申请机器人账号
### 2. 获取 机器人 `appid` 和 `secret`
## 配置 QQ 机器人适配器
### 1. 打开项目根目录下的 `config/zhin.config.yml` 文件
### 2. 在 `bots` 下添加以下配置
```yaml
bots:
  - adapter: qq
    unique_id: 机器人唯一标识
    appid: 你的 appid
    secret: 你的 secret
    group: false # 若你的机器人支持群聊，才可设置为 true
    public: false # 若你的机器人为公域机器人，才可设置为 true
    sandbox: false # 是否使用沙箱环境
```
## 启动 QQ 机器人
- 保存配置文件后，执行以下命令启动机器人
```shell
npx zhin
```
