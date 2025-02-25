# 接入 Onebot 11/12 机器人
::: info
Onebot 是一个开放的机器人协议，支持多种连接方式，现已更新到 OneBot 12。本文档将介绍如何接入 Onebot 11/12 机器人
:::

## 安装适配器
- 根据需要接入的 `OneBot` 版本，安装不同的适配器
::: code-group

```shell [Onebot 11]
npm install @zhinjs/adapter-onebot-11
```
```shell [Onebot 12]
npm install @zhinjs/adapter-onebot-12
```
:::
## 准备 Onebot 机器人必要参数
::: tip
知音 仅支持 正向ws 和 反向ws 两种连接方式，不支持 http 连接方式。
:::
- 请确保你已经有一个 `Onebot 实现端`，并且实现端支持 `正向ws` 或 `反向ws` 连接方式。

## 配置 Onebot 机器人适配器
### 1. 打开项目根目录下的 `config/zhin.config.yml` 文件
### 2. 在 `bots` 下添加以下配置
::: code-group
```yaml [Onebot 11正向ws]
bots:
  - adapter: onebot-11
    unique_id: 机器人唯一标识
    type: ws
    url: 正向ws地址
    max_reconnect_count: 10 # 重连次数
    reconnect_interval: 3000 # 重连间隔(ms)
    access_token: 鉴权token # 没有可不设置
```
```yaml [Onebot 12正向ws]
bots:
  - adapter: onebot-12
    unique_id: 机器人唯一标识
    type: ws
    url: 正向ws地址
    max_reconnect_count: 10 # 重连次数
    reconnect_interval: 3000 # 重连间隔(ms)
    access_token: 鉴权token # 没有可不设置
```
```yaml [Onebot 11反向ws]
bots:
  - adapter: onebot-11
    unique_id: 机器人唯一标识
    type: ws_reverse
    prefix: 监听路径 # 默认 /onebot/v11
    access_token: 鉴权token # 没有可不设置
```
```yaml [Onebot 12反向ws]
bots:
  - adapter: onebot-12
    unique_id: 机器人唯一标识
    type: ws_reverse
    prefix: 监听路径 # 默认 /onebot/v11
    access_token: 鉴权token # 没有可不设置
```
:::

## 启动 Onebot 机器人
- 保存配置文件后，执行以下命令启动机器人
```shell
npx zhin
```
::: tip
- 若为反向ws连接方式，请确保你的 `OneBot 实现端` 能够访问到知音服务端。并将服务端地址填写到 `OneBot 实现端` 的配置中。
- 若为正向ws连接方式，请确保zhin 能访问到你的 `OneBot 实现端`
