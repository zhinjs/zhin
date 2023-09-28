# 官方适配器(onebot)

## 介绍

[OneBot](https://www.npmjs.com/package/@zhinjs/adapter-onebot) 适配器是一个支持 [OneBot12](https://12.onebot.dev/) 标准的适配器，可以连接到任何支持 OneBot12 标准的机器人平台。

::: tip

你可以使用[onebots](https://icqqjs.github.io/onebots/)来快速部署一个符合 `OneBot12` 标准的QQ机器人服务。

:::
## 接入到zhin
### 1.安装适配器

- 在项目根目录下执行以下命令安装适配器

```bash
npm i @zhinjs/adapter-onebot
```

### 2.配置适配器

- 在配置文件`zhin.yaml`的`adapters`中增加如下配置，即可接入一个 `onebot` 机器人：

::: code-group
```yaml [HTTP]
adapters:
  onebot:
    bots:
      - self_id: 147258369
        type: http
        url: http://host:port/path # oneBot http api 地址
        access_token: 123456789 # oneBot http api token
        get_events_interval: 1000 # 获取事件间隔
        events_buffer_size: 100 # 事件缓冲区大小
        timeout: 10000 # 请求超时时间
```
```yaml [Webhook]
adapters:
  onebot:
    bots:
      - self_id: 147258369
        type: webhook
        path: /path # oneBot webhook挂载路径
        get_actions_path: /path # 获取动作缓存路径
        access_token: 123456789 # oneBot http api token
        timeout: 10000 # 请求超时时间
```
```yaml [WebSocket]
adapters:
  onebot:
    bots:
      - self_id: 147258369
        type: ws
        url: ws://host:port/path # oneBot ws api 地址
        access_token: 123456789 # oneBot ws api token
        reconnect_interval: 1000 # 重连间隔
        max_reconnect_times: 10 # 最大重连次数
```
```yaml [WebSocket Reverse]
adapters:
  onebot:
    bots:
      - self_id: 147258369
        type: ws_reverse
        path: /path # oneBot ws_reverse挂载路径
        access_token: 123456789 # oneBot ws api token
```
- 其中 `self_id` 对应`onebot` 的 `self_id`，作为一个机器人的唯一标识
- `type` 代表你要连接的方式，目前支持 `http`、`webhook`、`ws`、`ws_reverse`

### 3.启动

配置完成后，重启 `zhin`，将自动开始连接 对应的 `onebot` 机器人
