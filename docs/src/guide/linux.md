# 在 Linux / Mac 电脑上使用知音
## 安装 Node.js
- 下载 [Node.js](https://nodejs.org/zh-cn/download/) 并安装
- 安装时请勾选 `npm` 选项
- 安装时请勾选 `Add to PATH` 选项
- 安装完成后，打开 `cmd` 输入 `node -v` 和 `npm -v` 查看是否安装成功
## 安装知音
- 新建一个文件夹，打开 `cmd` 输入 `cd 文件夹路径` 进入文件夹，执行以下命令
```shell
npm init -y # 初始化一个新的项目
npm install zhin # 安装 zhin
```
- 如果速度慢，可考虑使用国内镜像
```shell
npm install zhin --registy https://registry.npmmirror.com
```
## 初始化知音
```shell
npx zhin init
```
## 启动知音
```shell
npx zhin
```
