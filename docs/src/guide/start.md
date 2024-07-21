# 安装 zhin 机器人

::: tip
阅读本节前，请确认你已正确配置 [Node.js](https://nodejs.org/zh-cn) 环境。
:::

## 创建项目

### 1. 自行选择或新建一个文件夹，用于存储zhin机器人配置和插件信息
```shell
# 建立zhin-app文件夹（若选择已有文件夹，则可跳过本步骤）
mkdir zhin-app
cd zhin-app
```

### 2. 初始化包管理器
```shell
npm init -y # 初始化package.json

npm install typescript -D # 安装ts开发环境依赖

npx tsc --init # 初始化tsconfig.json文件

```
### 3. 安装zhin
```shell
npm install zhin # 安装zhin
```

### 4. 初始化项目
```shell
npx zhin init # 生成zhin配置文件

```

## 项目结构

构建完成后，我们可在项目文件夹下看到如下结构

```tex
.
├─ data/              资源目录
├─ plugins/           插件目录（存放编写好的插件）
├─ zhin.config.yml          配置文件
├─ node_modules/      项目依赖存放文件(npm自动生成，开发者无需关心)
├─ package.json       项目描述文件(一般情况下无需关心)
└─ package-lock.json  项目依赖描述文件(npm自动生成，开发者无需关心)
```

::: tip
`node_modules`、`package.json` 等都是由 npm 生成的，**仅开发者**需要了解，可参考 [插件开发](/plugin/start) 一节。
:::

## 选择安装你所需添加机器人的适配器

默认情况下，zhin仅基本提供命令行适配，添加对应机器人需先安装对应的适配器
::: code-group
```shell [ICQQ]
npm install @zhinjs/adapter-icqq
```
```shell [QQ官方机器人]
npm install @zhinjs/adapter-qq
```
```shell [onebot-11]
npm install @zhinjs/adapter-onebot-11
```
```shell [onebot-12]
npm install @zhinjs/adapter-onebot-12
```
```shell [Discord]
npm install @zhinjs/adapter-discord
```
```shell [钉钉]
npm install @zhinjs/adapter-dingtalk
```
```shell [微信]
npm install @zhinjs/adapter-wechat
```
:::

## 添加对应平台的机器人

::: code-group
```shell [ICQQ]
npx zhin # 启动zhin
# 等待启动完成...
adapter.add @zhinjs/adapter-icqq # 注册适配器
# 等待zhin 自动重启...
bot.add icqq # 添加bot配置
# 根据提示添加...
```
```shell [QQ官方机器人]
npx zhin # 启动zhin
# 等待启动完成...
adapter.add @zhinjs/adapter-qq # 注册适配器
# 等待zhin 自动重启...
bot.add qq # 添加bot配置
# 根据提示添加...
```
```shell [onebot-11]
npx zhin # 启动zhin
# 等待启动完成...
adapter.add @zhinjs/adapter-onebot-11 # 注册适配器
# 等待zhin 自动重启...
bot.add onebot-11 # 添加bot配置
# 根据提示添加...
```
```shell [onebot-12]
npx zhin # 启动zhin
# 等待启动完成...
adapter.add @zhinjs/adapter-onebot-12 # 注册适配器
# 等待zhin 自动重启...
bot.add onebot-12 # 添加bot配置
# 根据提示添加...
```
```shell [Discord]
npx zhin # 启动zhin
# 等待启动完成...
adapter.add @zhinjs/adapter-discord # 注册适配器
# 等待zhin 自动重启...
bot.add discord # 添加bot配置
# 根据提示添加...
```
```shell [钉钉]
npx zhin # 启动zhin
# 等待启动完成...
adapter.add @zhinjs/adapter-dingtalk # 注册适配器
# 等待zhin 自动重启...
bot.add dingtalk # 添加bot配置
# 根据提示添加...
```
```shell [微信]
npx zhin # 启动zhin
# 等待启动完成...
adapter.add @zhinjs/adapter-wechat # 注册适配器
# 等待zhin 自动重启...
bot.add wechat # 添加bot配置
# 根据提示添加...
```
:::
## 测试一下

- 至此，你已成功为 zhin 添加了你的第一个机器人
- 你可通过向对应机器人发送 `status` 查看他是否正常工作(若添加机器人是配置了`command_prefix`,则需发送`[你配置的前缀] + status`)

## 更多
若需熟练运用zhin，你还需了解如何编写插件，以及各种专有名词，你可访问后续章节学习到相关知识
