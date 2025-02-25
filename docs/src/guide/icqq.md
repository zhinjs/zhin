# 接入icqq
## 安装 icqq 机器人适配器
```shell
npm install @zhinjs/adapter-icqq
```
## 准备一个 `QQ号`、`密码`、以及 `icqq 签名api` 地址
### 1. 前往 [QQ](https://im.qq.com/) 申请一个QQ号，并记住对应的密码(如果已有qq，可忽略)
### 2. 自行获取 `icqq 签名api` 地址
## 配置 icqq 机器人适配器
### 1. 打开项目根目录下的 `config/zhin.config.yml` 文件
### 2. 在 `bots` 下添加以下配置
```yaml
bots:
  - adapter: icqq
    unique_id: 机器人唯一标识
    qq: 你的qq号
    password: 你的qq密码 # 不填则扫码登录
    sign_api_addr: icqq签名api地址
    ver: 使用的qq版本 # 请与确保签名api支持该版本
    platform: 登录设备平台
  # 安卓手机(Android) 填 1 
  # 安卓平板(aPad) 填 2
  # 安卓手表(Watch) 填 3
  # MacOS(Mac电脑) 填 4
  # iPad(苹果平板) 填 5
```
## 启动 icqq 机器人
- 保存配置文件后，执行以下命令启动机器人
```shell
npx zhin
```
- 根据提示，完成登录验证即可
