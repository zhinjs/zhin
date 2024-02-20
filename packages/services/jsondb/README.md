# @zhinjs/plugin-jsondb
- 本地json数据库
- 支持存储函数
- 支持存储循环应用对象
## 安装 
```shell
yarn add @zhinjs/plugin-jsondb
```
## 启用
1. 在 `zhin` 的配置文件中添加环境变量 `jsondb` ，值为 数据库存储文件名
2. 在 `zhin` 的配置文件的 `modulePlugins` 声明使用插件 `@zhinjs/plugin-jsondb`
- 若配置文件中没有 `modulePlugins` 定义
```text
modulePlugins = @zhinjs/plugin-jsondb
```
- 若配置文件中已有 `modulePlugins` 定义
```text
modulePlugins = ...其他定义,@zhinjs/plugin-jsondb
```
## 使用
- 完成上述配置后，你可在自己的插件中通过调用 `plugin.jsondb` 访问到数据库实例，并可通过该实例对数据库进行增删改查的操作
```javascript
// 定义test为一个新对象或重写对象
plugin.jsondb.set('test',{name:'小黑子',hobby:['唱','跳','Rap','篮球']})

// 更改为已有对象添加新属性
plugin.jsondb.set('test.sex','男')
// 获取已有对象的值
plugin.jsondb.get('test.hobby') //返回数组 ['唱','跳','Rap','篮球']

// 删除指定值
plugin.jsondb.delete('test.sex')

// 删除数组中指定下标的元素
plugin.jsondb.splice('test.hobby',0,1) // 同数组原生方法 Array.split

// 从数组头部插入数据
plugin.jsondb.unshift('test.hobby','打游戏') // 同数组原生方法 Array.unshift

// 删除数组头部的第一个元素 
plugin.jsondb.shift('test.hobby') // 同数组原生方法 Array.shift

// 从数组尾部的插入数据 
plugin.jsondb.push('test.hobby','刷抖音') // 同数组原生方法 Array.push

// 删除数组尾部的第一个元素 
plugin.jsondb.pop('test.hobby') // 同数组原生方法 Array.pop

// 查询满足条件的元素
plugin.jsondb.filter('test.hobby',(item)=>{return item.length===1}) // 同数组原生方法 Array.filter

// 查询满足条件的第一个元素 
plugin.jsondb.find('test.hobby',(item)=>{return item.length===1}) // 同数组原生方法 Array.find
```
