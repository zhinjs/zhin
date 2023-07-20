# 内置插件

zhin内置了`7`个插件，作为协助开发者管理zhin的基础，让我们来认识下这`七个葫芦娃`

## 帮助(help)

用户使用zhin的`command`定义了指令，使用`help`可以获取对应帮助文本

### 功能描述

- 1.聊天中输入`help`会获得到**当前可用**指令的帮助
- 2.聊天中输入`help [pluginName:string]`可获取**对应指令名**的帮助文本

### 配置项

无

## 辅助登录(login)

用户在登录icqq的过程中如果触发相关登录验证，可通过命令行完成验证

### 功能描述

- 1.当触发`system.login.slider`事件时，可通过命令行输入对应ticket
- 2.当触发`system.login.qrcode`事件时，可在扫码后回车继续当前流程
- 3.当触发`system.login.device`事件时，可通过命令行选择验证方式和接收验证方式参
  数

### 配置项

无

## 配置文件管理(config)

可通过聊天的形式更改zhin的配置文件

### 功能描述

- 1.聊天中输入`config` 可以查看当前zhin的**所有**配置
- 2.聊天中输入`config <keyPath:string>`可以**查看**当前zhin的**对应keyPath**的配
  置
- 3.聊天中输入`config -d <keyPath:stirng>`可以**删除**当前zhin的**对应
  keyPath**的配置
- 4.聊天中输入`config <keyPath:string> <value>`可以**修改**(没有则添加)当前zhin
  的**对应keyPath**的配置为对应值

### 配置项

无

## 插件管理(plugin)

可通过聊天的形式管理zhin的插件

### 功能描述

- 1.聊天中输入`plugin.list` 可以查看当前zhin的**所有**插件
- 2.聊天中输入`config.detail <name:stirng>`可以**查看**当前zhin的\*\*对应名称的
  插件
- 3.聊天中输入`config.mount <name:string>`可以**挂载**指定名称的插件到zhin
- 4.聊天中输入`config.unmount <name:string>`可以**取消挂载**zhin中指定名称的插件
- 5.聊天中输入`config.enable <name:string>`可以**启用**指定名称的插件
- 6.聊天中输入`config.disable <name:string>`可以**禁用**指定名称的插件

### 配置项

无

## 热更新(watcher)

提供zhin插件开发过程中热更新的功能

### 功能描述

- 1.在插件代码变化是，自动重载对应插件
- 2.在配置文件中添加或删除插件时，自动加载或取消加载对应插件

### 配置项

ke传入一个文件夹地址作为监听目录，默认为项目文件夹，建议不要更改，否则可能会造成
第二个功能无法使用

## 进程守护(daemon)

提供zhin进程守护的能力和手动重启的能力

### 功能描述

- 1.在意外意外中断时，自动重启zhin
- 2.在聊天中，可使用指定的命令重启zhin

### 配置项

| 配置名      | 值类型              | 默认值 | 描述                                                                 |
| :---------- | :------------------ | :----- | :------------------------------------------------------------------- |
| exitCommand | stirng&#124;boolean | true   | 是否启用退出指令，传字符串时，则自定义退出指令，默认退出指令为`exit` |
| autoRestart | boolean             | true   | 是否自动重启                                                         |

## 系统信息(systemInfo)

提供日志查看和状态查看指令

### 功能描述

- 1.在聊天中，可使用`logs [lines:number]`查看zhin指定行数的日志，(默认为10行)
- 2.在聊天中，可使用`status`查看zhin当前的运行状态

### 配置项

无
