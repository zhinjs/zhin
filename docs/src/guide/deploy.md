# 部署到服务器

1. 在[ Node.js 官网](https://nodejs.org/en/download/)选择适合你服务器操作系统的 Node.js 版本安装到服务器
2. 安装完成 `Node.js` 后，使用其自带的 `npm` 全局安装 `pm2`

```shell
npm install -g pm2
```

## 使用 cli 快速部署到 Linux 服务器

在项目根目录执行下面的命令，即可快速将当前项目部署到远程 linux 服务器

:::tip
1. 尖括号(`<>`)为必填参数，方括号(`[]`)为选题参数
2. username 不传时默认为 `root`
3. 未传 password 时，使用 `sshKey` 登录，`sshKey` 默认为 `~/.ssh/${ip}.pem`
4. 传了 password 时，sshKey 将失效，直接使用密码登录
5. directory 不传时默认为 `~/{当前项目名}`
:::

```shell
zhin deploy <服务器ip> [-u <username>] [-p <password> | -k <sshKey>] [-d <directory>]
```

## 自行部署到其他操作系统的服务器

1. 在服务器上安装 Zhin 脚手架 `@zhinjs/cli`

```shell
npm install @zhinjs/cli -g
```

2. 使用 cli 初始化一个空项目

```shell
zhin init zhin-app
```

3. 将本地项目的 `package.json`、`plugins`、`data`、`zhin.yaml` 拷贝到服务器刚刚创建的空项目中
1. 在服务器上安装项目依赖

```shell
cd zhin-app && npm install
```

5. 使用 pm2 启动 Zhin

```shell
pm2 start npm --name zhin -- run start:zhin
```
