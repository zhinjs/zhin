# 接入 微信(web)
## 安装适配器
```shell
npm install @zhinjs/adapter-web-wechat
```
## 配置 微信机器人 适配器
### 1. 打开项目根目录下的 `config/zhin.config.yml` 文件
### 2. 在 `bots` 下添加以下配置
```yaml
bots:
  - adapter: web-wechat
    unique_id: 机器人唯一标识
```
## 启动 微信 机器人
- 保存配置文件后，执行以下命令启动机器人
```shell
npx zhin
```
- 根据提示，使用手机端微信完成扫码登录即可
