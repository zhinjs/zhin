# tripTrap
轻，但很实用的事件发布订阅器
# 安装
```shell
npm i triptrap
```
# 使用
- 第一种方式，使用class 实例化
```javascript
const Trapper = require('triptrap')
const trapper=new Trapper()
// 常规定义
trapper.trap('foo',(...args)=>{
    console.log('我是常规监听器',args)
})
trapper.trip('foo','bar')
// 正则匹配
trapper.trap(/system\..+/,(event)=>{
    console.log('我是系统事件监听器',event)
})
trapper.trip('system.login',{type:'online'})
// 使用filter
// 定义过滤器
const user=(...userIds)=>{
    return (eventName,userInfo)=>{
        return userIds.includes(userInfo.user_id)
    }
}
// 订阅user_id为foo或bar的事件
trapper.trap(user('foo','bar'),(userInfo)=>{
    console.log('你是foo还是bar',userInfo)
})
// 发布私聊事件
trapper.trip('message.private',{user_id:'foo',user_name:'小菊'})
```
- 第二种方式，使用defineTripTrap
```javascript
const {defineTripTrap} = require('triptrap')
const {trip,trap}=defineTripTrap

// 常规定义
trap('foo',(...args)=>{
    console.log('我是常规监听器',args)
})
trip('foo','bar')
// 正则匹配
trap(/system\..+/,(event)=>{
    console.log('我是系统事件监听器',event)
})
trip('system.login',{type:'online'})
// 使用filter
// 定义过滤器
const user=(...userIds)=>{
    return (eventName,userInfo)=>{
        return userIds.includes(userInfo.user_id)
    }
}
// 订阅user_id为foo或bar的事件
trap(user('foo','bar'),(userInfo)=>{
    console.log('你是foo还是bar',userInfo)
})
// 发布私聊事件
trip('message.private',{user_id:'foo',user_name:'小菊'})
```
# 如何取消监听？
## 1. 通过返回函数取消监听
```javascript

const Trapper = require('triptrap')
const trapper=new Trapper()
// 常规定义
const dispose=trapper.trap('foo',(...args)=>{
    console.log('我是常规监听器',args)
})
// 在不需要时，调用返回函数，即可取消监听
dispose()
```
## 2. 通过offTrap取消监听

```javascript

const Trapper = require('triptrap')
const trapper=new Trapper()
// 常规定义
const listener=(...args)=>{
    console.log('我是常规监听器',args)
}
trapper.trap('foo',listener)
// 在不需要时，使用offTrap取消监听
trapper.offTrap('foo',listener)
```