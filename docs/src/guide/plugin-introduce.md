# 插件介绍

## 插件类型

zhin 的插件共分为  `内置插件` 、`本地插件` 、`npm 插件` 和 `git 插件` 四类。
- 内置插件

为了给开发者提供更良好的开发体验， zhin 内置了部分插件，以方便用户管理适配器、插件、机器人、配置文件 `zhinManager`，基本输出测试 `echo`，以及一些基本系统运行所需功能(指令解析 `commandParser` 、热重载 `hmr` 、setup语法支持 `setup` )

::: tip
内置插件默认为启用状态，你可根据自身需求进行禁用
:::
- 本地插件

本地插件将全部存放在根目录的 plugins 下。所有由你自己编写或从 `git clone` 而来，并仅供**个人使用**的插件就可以称为本地插件。

- npm 插件

npm 插件可使用 `npm install [moduleName]` 或 `plugin.add [moduelName]` 命令进行安装，存放在 `node_modules` 目录下。是由我或者其他开发者编写，上传至 `npmjs` 平台，为 **所有使用 zhin 框架的人** 提供服务。


- git插件

`git插件` 通常为存放于某个git仓库的单独项目，使用git插件时，需使用 `plugin.add [url]` 将对应的git项目 clone 到本地插件目录后，作为本地插件使用(若该项目有依赖其他 npm 模块，需要你手动进行依赖安装)
## setup 语法

::: tip
zhin 通过内置的 `setup` 插件支持了 *setup* 语法 ，使用前请确保启用了内置插件 `setup`
:::
- zhin的插件开发参考了 `Vue` 的 [script setup](https://cn.vuejs.org/guide/typescript/composition-api.html#using-script-setup) 设计，使得用户可以写更少的代码，实现相同的功能

### setup 示例

::: code-group

```javascript [JavaScript-setup]
const {command} = require('zhin');

command('foo')
.action(()=>'bar')

```

```typescript [TypeScript-setup]
import {command} from 'zhin'

command('foo')
.action(()=>'bar')

```
:::
- 对于 zhin 而言，这都是一个有效的插件
- 更多 setup 语法，请前往 [setup](./setup.md) 了解

## 插件管理
- zhin 通过内置插件 `zhinManager` 提供了插件管理的指令，你可在 `zhin` 启动后，在命令行键入相应指令，管理插件

### 新建插件
```shell
plugin.new [插件名] # 新建基于 JavaScript 开发的插件
# or
plugin.new [插件名] -t # 新建基于 TypeScript 开发的插件
```
### 安装插件
```shell
plugin.install [packageName] # 安装 npm 模块插件
# or
plugin.install [url] # clone git仓库作为插件
```
### 挂载插件
- 只能挂载已安装的插件
```shell
plugin.add [插件名]
```
### 取消挂载插件
```shell
plugin.remove [插件名]
```
### 启用插件
- 只能启用已挂载的插件
```shell
plugin.enable [插件名]
```
### 禁用插件
```shell
plugin.disable [插件名]
```
### 发布插件
- 仅能发布使用 `plugin.new` 创建的插件
- 需要你有 `npmjs` 账号并且具备对应包名的发布权限
```shell
plugin.publish [插件名]
```
### 推送插件变更
- 仅能推送通过 `git` 拉取的插件
- 需要你具备对应仓库的推送权限
```shell
plugin.push [插件名] # 推送已commit的git变更
# or
plugin.push [插件名] -m [message:string] # commit 所有 git 变更并提交
```
### 拉取插件变更
- 仅能拉取通过 `git` 拉取的插件
- 需要你具备对应仓库的拉取权限
```shell
plugin.pull [插件名]
```
