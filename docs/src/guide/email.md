# 接入邮箱
## 安装适配器
```bash
npm install @zhinjs/adapter-email
```
## 准备工作
- 访问你的邮箱，获取邮箱的SMTP服务器地址和端口号
- 获取邮箱的用户名和密码
- 获取邮箱的IMAP服务器地址和端口号
:::tip
- 部分邮箱使用授权码代替密码，如QQ邮箱，需要在邮箱设置中开启SMTP服务，并获取授权码
- 部分邮箱需要开启IMAP服务，如QQ邮箱，需要在邮箱设置中开启IMAP服务
:::

## 配置邮箱机器人适配器
### 1. 打开项目根目录下的 `config/zhin.config.yml` 文件
### 2. 在 `bots` 下添加以下配置
```yaml
bots:
  - adapter: email
    unique_id: 机器人唯一标识
    username: 邮箱用户名
    password: 邮箱密码 # 或授权码
    smtp:
      host: SMTP服务器地址 # 如QQ邮箱 smtp.qq.com
      port: SMTP服务器端口号 # 默认 465
      tls: true # 是否启用TLS
    imap:
      host: IMAP服务器地址 # 如QQ邮箱 imap.qq.com
      port: IMAP服务器端口号 # 默认 993
      tls: true # 是否启用TLS
```

## 启动邮箱机器人
- 保存配置文件后，执行以下命令启动机器人
```bash
npx zhin
```

