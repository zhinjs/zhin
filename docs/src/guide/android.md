# 在 安卓 手机上使用知音
## 安装 Termux
- 下载 [Termux](https://play.google.com/store/apps/details?id=com.termux) 并安装
## 配置国内镜像
- 打开 Termux 输入以下命令
```shell
sed -i 's@^\(deb.*stable main\)$@#\1\ndeb https://mirrors.aliyun.com/termux/termux-packages-24 stable main@' $PREFIX/etc/apt/sources.list
sed -i 's@^\(deb.*games stable\)$@#\1\ndeb https://mirrors.aliyun.com/termux/game-packages-24 games stable@' $PREFIX/etc/apt/sources.list.d/game.list
sed -i 's@^\(deb.*science stable\)$@#\1\ndeb https://mirrors.aliyun.com/termux/science-packages-24 science stable@' $PREFIX/etc/apt/sources.list.d/science.list

pkg update
```
## 安装 Node.js
```shell
pkg install nodejs
```
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
