# Prompt 交互

Prompt 系统允许你创建交互式对话，让机器人等待用户的下一步输入。

## 基础使用

### 创建 Prompt

```typescript
import { addCommand, MessageCommand, usePrompt } from 'zhin.js'

addCommand(new MessageCommand('demo')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    // 等待用户输入
    const answer = await prompt.text('请输入你的名字：')
    
    return `你好，${answer}！`
  })
)
```

使用示例：

```
> demo
< 请输入你的名字：
> 张三
< 你好，张三！
```

## Prompt 类型

### text - 文本输入

等待用户输入任意文本：

```typescript
addCommand(new MessageCommand('register')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    const name = await prompt.text('请输入你的用户名：')
    const email = await prompt.text('请输入你的邮箱：')
    
    return `注册成功！\n用户名：${name}\n邮箱：${email}`
  })
)
```

### number - 数字输入

等待用户输入数字：

```typescript
addCommand(new MessageCommand('age')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    const age = await prompt.number('请输入你的年龄：')
    
    if (age < 18) {
      return '你还未成年'
    } else {
      return '你已成年'
    }
  })
)
```

### confirm - 确认输入

等待用户确认（是/否）：

```typescript
addCommand(new MessageCommand('delete')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    const confirmed = await prompt.confirm('确定要删除吗？')
    
    if (confirmed) {
      // 执行删除
      return '已删除'
    } else {
      return '已取消'
    }
  })
)
```

### pick - 选择输入

让用户从选项中选择：

```typescript
addCommand(new MessageCommand('choose')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    const choice = await prompt.pick('请选择一个选项：', {
      type: 'text',
      options: [
        { label: '选项1', value: 'option1' },
        { label: '选项2', value: 'option2' },
        { label: '选项3', value: 'option3' }
      ]
    })
    
    return `你选择了：${choice}`
  })
)
```

使用示例：

```
> choose
< 请选择一个选项：
  1. 选项1
  2. 选项2
  3. 选项3
> 1
< 你选择了：option1
```

## 实战示例

### 音乐点歌（来自 test-bot）

```typescript
import { addCommand, MessageCommand, useContext, usePrompt } from 'zhin.js'

interface Music {
  type: 'qq' | '163'
  id: string
  name: string
  artist?: string
}

async function searchQQMusic(keyword: string): Promise<Music[]> {
  const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg')
  url.searchParams.set('key', keyword)
  url.searchParams.set('format', 'json')
  
  const { data } = await fetch(url).then(res => res.json())
  
  return data.song.itemlist.map((song: any) => ({
    type: 'qq' as const,
    name: song.name,
    id: song.id
  }))
}

async function search163Music(keyword: string): Promise<Music[]> {
  const url = new URL('https://music.163.com/api/search/get/')
  const result = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ 
      s: keyword, 
      type: '1', 
      limit: '3', 
      offset: '0' 
    })
  }).then(res => res.json())
  
  return result.result.songs.map((song: any) => ({
    type: '163' as const,
    name: song.name,
    id: song.id,
    artist: song.artist
  }))
}

useContext('icqq', (adapter) => {
  addCommand(new MessageCommand('点歌 <keyword>')
    .scope('icqq')
    .action(async (message, result) => {
      const keyword = result.params.keyword
      
      // 并发搜索多个平台
      const [musicFromQQ, musicFrom163] = await Promise.all([
        searchQQMusic(keyword),
        search163Music(keyword)
      ])
      
      const allMusic = [...musicFromQQ, ...musicFrom163].filter(Boolean)
      
      if (allMusic.length === 0) {
        return '没有找到相关歌曲'
      }
      
      // 使用 Prompt 让用户选择
      const prompt = usePrompt(message)
      const musicId = await prompt.pick('请选择搜索结果', {
        type: 'text',
        options: allMusic.map(music => ({
          label: `${music.name} (from ${music.type})`,
          value: music.id
        }))
      })
      
      if (!musicId) {
        return '已取消'
      }
      
      const selectedMusic = allMusic.find(m => m.id === musicId)!
      
      // 根据消息类型发送音乐卡片
      switch (message.message_type) {
        case 'private':
          await message.friend.shareMusic(selectedMusic.type, selectedMusic.id)
          break
        case 'group':
          await message.group.shareMusic(selectedMusic.type, selectedMusic.id)
          break
      }
      
      return '✅ 已发送'
    })
  )
})
```

测试效果：

```
> 点歌 晴天
< 请选择搜索结果
  1. 晴天 (from qq)
  2. 晴天 (from 163)
  3. 晴天 - 周杰伦 (from 163)
> 3
< ✅ 已发送
[音乐卡片]
```

### 问卷调查

```typescript
import { addCommand, MessageCommand, usePrompt } from 'zhin.js'

addCommand(new MessageCommand('survey')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    // 1. 基本信息
    const name = await prompt.text('请输入你的姓名：')
    const age = await prompt.number('请输入你的年龄：')
    
    // 2. 单选题
    const gender = await prompt.pick('请选择你的性别：', {
      type: 'text',
      options: [
        { label: '男', value: 'male' },
        { label: '女', value: 'female' },
        { label: '其他', value: 'other' }
      ]
    })
    
    // 3. 多选题
    const hobbies = await prompt.multiPick('请选择你的爱好（可多选）：', {
      type: 'text',
      options: [
        { label: '阅读', value: 'reading' },
        { label: '运动', value: 'sports' },
        { label: '音乐', value: 'music' },
        { label: '游戏', value: 'gaming' }
      ]
    })
    
    // 4. 确认
    const confirmed = await prompt.confirm('确认提交吗？')
    
    if (!confirmed) {
      return '已取消'
    }
    
    return [
      '✅ 提交成功！',
      '',
      '问卷结果：',
      `姓名：${name}`,
      `年龄：${age}`,
      `性别：${gender}`,
      `爱好：${hobbies.join(', ')}`
    ].join('\n')
  })
)
```

### 交互式配置

```typescript
import { addCommand, MessageCommand, usePrompt } from 'zhin.js'

addCommand(new MessageCommand('config')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    // 选择要配置的项目
    const item = await prompt.pick('请选择要配置的项目：', {
      type: 'text',
      options: [
        { label: '通知设置', value: 'notification' },
        { label: '隐私设置', value: 'privacy' },
        { label: '显示设置', value: 'display' }
      ]
    })
    
    if (!item) return '已取消'
    
    // 根据选择的项目进行不同配置
    switch (item) {
      case 'notification':
        const notify = await prompt.confirm('是否开启通知？')
        const sound = await prompt.confirm('是否开启声音？')
        return `✅ 通知设置已更新\n通知：${notify ? '开启' : '关闭'}\n声音：${sound ? '开启' : '关闭'}`
      
      case 'privacy':
        const visibility = await prompt.pick('选择可见性：', {
          type: 'text',
          options: [
            { label: '公开', value: 'public' },
            { label: '好友可见', value: 'friends' },
            { label: '仅自己', value: 'private' }
          ]
        })
        return `✅ 隐私设置已更新\n可见性：${visibility}`
      
      case 'display':
        const theme = await prompt.pick('选择主题：', {
          type: 'text',
          options: [
            { label: '浅色', value: 'light' },
            { label: '深色', value: 'dark' },
            { label: '自动', value: 'auto' }
          ]
        })
        return `✅ 显示设置已更新\n主题：${theme}`
    }
  })
)
```

### 多步向导

```typescript
import { addCommand, MessageCommand, usePrompt, onDatabaseReady } from 'zhin.js'

onDatabaseReady(async (db) => {
  const tasks = db.model('tasks')
  
  addCommand(new MessageCommand('create-task')
    .action(async (message) => {
      const prompt = usePrompt(message)
      
      // 步骤1：任务标题
      await message.$reply('📝 创建任务向导\n第1步：输入任务标题')
      const title = await prompt.text('请输入任务标题：')
      
      if (!title) return '已取消'
      
      // 步骤2：任务描述
      await message.$reply('第2步：输入任务描述')
      const description = await prompt.text('请输入任务描述（可选，输入"跳过"跳过）：')
      const finalDescription = description === '跳过' ? '' : description
      
      // 步骤3：优先级
      await message.$reply('第3步：选择优先级')
      const priority = await prompt.pick('选择任务优先级：', {
        type: 'text',
        options: [
          { label: '🔴 高', value: 'high' },
          { label: '🟡 中', value: 'medium' },
          { label: '🟢 低', value: 'low' }
        ]
      })
      
      if (!priority) return '已取消'
      
      // 步骤4：截止日期
      await message.$reply('第4步：设置截止日期')
      const dueDate = await prompt.text('请输入截止日期（格式：YYYY-MM-DD，输入"无"跳过）：')
      const finalDueDate = dueDate === '无' ? null : dueDate
      
      // 步骤5：确认
      const confirmMsg = [
        '📋 任务预览：',
        `标题：${title}`,
        `描述：${finalDescription || '无'}`,
        `优先级：${priority}`,
        `截止：${finalDueDate || '无'}`,
        '',
        '确认创建吗？'
      ].join('\n')
      
      const confirmed = await prompt.confirm(confirmMsg)
      
      if (!confirmed) return '已取消'
      
      // 保存到数据库
      await tasks.create({
        user_id: message.$sender.id,
        title,
        description: finalDescription,
        priority,
        due_date: finalDueDate,
        status: 'pending',
        created_at: new Date()
      })
      
      return '✅ 任务创建成功！'
    })
  )
})
```

## 高级用法

### 超时处理

```typescript
addCommand(new MessageCommand('quick')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    try {
      // 设置30秒超时
      const answer = await Promise.race([
        prompt.text('请在30秒内回答：'),
        new Promise<null>((_, reject) => 
          setTimeout(() => reject(new Error('超时')), 30000)
        )
      ])
      
      if (answer === null) {
        return '⏱️ 已超时，请重新开始'
      }
      
      return `收到：${answer}`
    } catch (error) {
      return '⏱️ 已超时，请重新开始'
    }
  })
)
```

### 循环提示

```typescript
addCommand(new MessageCommand('quiz')
  .action(async (message) => {
    const prompt = usePrompt(message)
    let score = 0
    
    const questions = [
      { q: '1 + 1 = ?', a: '2' },
      { q: '2 * 3 = ?', a: '6' },
      { q: '10 / 2 = ?', a: '5' }
    ]
    
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i]
      const answer = await prompt.text(`第${i + 1}题：${question.q}`)
      
      if (answer === question.a) {
        await message.$reply('✅ 正确！')
        score++
      } else {
        await message.$reply(`❌ 错误，正确答案是 ${question.a}`)
      }
    }
    
    return `测试结束！得分：${score}/${questions.length}`
  })
)
```

### 条件分支

```typescript
addCommand(new MessageCommand('wizard')
  .action(async (message) => {
    const prompt = usePrompt(message)
    
    const userType = await prompt.pick('你是？', {
      type: 'text',
      options: [
        { label: '新用户', value: 'new' },
        { label: '老用户', value: 'old' }
      ]
    })
    
    if (userType === 'new') {
      // 新用户流程
      const name = await prompt.text('欢迎！请输入你的昵称：')
      const age = await prompt.number('请输入你的年龄：')
      return `注册成功！欢迎 ${name}`
    } else {
      // 老用户流程
      const action = await prompt.pick('你想做什么？', {
        type: 'text',
        options: [
          { label: '查看信息', value: 'view' },
          { label: '修改信息', value: 'edit' }
        ]
      })
      
      if (action === 'view') {
        return '你的信息...'
      } else {
        const field = await prompt.pick('修改什么？', {
          type: 'text',
          options: [
            { label: '昵称', value: 'name' },
            { label: '年龄', value: 'age' }
          ]
        })
        const newValue = await prompt.text(`请输入新的${field}：`)
        return `✅ ${field}已更新为${newValue}`
      }
    }
  })
)
```

## 最佳实践

### 1. 提供清晰的提示

```typescript
// ❌ 不好
const answer = await prompt.text('输入：')

// ✅ 好
const answer = await prompt.text('请输入你的用户名（3-20个字符）：')
```

### 2. 处理取消情况

```typescript
const answer = await prompt.text('请输入：')

if (!answer) {
  return '操作已取消'
}

// 继续处理
```

### 3. 提供默认选项

```typescript
const choice = await prompt.pick('选择操作：', {
  type: 'text',
  options: [
    { label: '继续（推荐）', value: 'continue' },
    { label: '取消', value: 'cancel' }
  ]
})
```

### 4. 验证用户输入

```typescript
const email = await prompt.text('请输入邮箱：')

if (!email.includes('@')) {
  return '❌ 邮箱格式不正确'
}

// 继续处理
```

## 注意事项

1. **Prompt 会话是独立的** - 每个用户的 prompt 会话互不干扰
2. **超时处理** - 建议设置合理的超时时间，避免会话长时间占用
3. **用户可以随时取消** - 发送"取消"或"退出"会中断 prompt
4. **不要嵌套过深** - 避免创建超过5层的交互流程

## 下一步

- 🎨 [组件系统](/guide/components) - 结合组件创建更丰富的交互
- 💾 [数据库](/guide/database) - 保存用户的交互数据
- 💡 [实战示例](/examples/prompts) - 更多 Prompt 应用场景

