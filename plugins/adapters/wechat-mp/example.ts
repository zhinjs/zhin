import { createApp } from 'zhin.js'
import WeChatMPAdapter from './lib/index.js'

// 创建微信公众号机器人应用
const app = createApp({
  // 需要先启用 HTTP 插件
  plugins: ['@zhin.js/host-router'],
  adapters: {
    'wechat-mp': {
      context: 'wechat-mp',
      name: 'my-wechat-bot',
      appId: process.env.WECHAT_APP_ID || 'your-app-id',
      appSecret: process.env.WECHAT_APP_SECRET || 'your-app-secret', 
      token: process.env.WECHAT_TOKEN || 'your-token',
      path: '/wechat'  // webhook 路径
    }
  }
})

// 处理文本消息
app.on('message.receive', (message) => {
  if (message.$adapter !== 'wechat-mp') return;
  
  console.log(`收到来自 ${message.$sender.name} 的消息:`, message.$content);
  
  // 简单的聊天机器人逻辑
  for (const segment of message.$content) {
    if (segment.type === 'text') {
      const text = segment.data.text || '';
      
      if (text.includes('你好') || text.includes('hello')) {
        message.$reply('你好！欢迎使用我们的服务！');
      } else if (text.includes('时间')) {
        message.$reply(`现在时间是：${new Date().toLocaleString('zh-CN')}`);
      } else if (text.includes('帮助')) {
        message.$reply(`
可用命令：
• 发送"你好" - 获取问候
• 发送"时间" - 获取当前时间  
• 发送"帮助" - 显示此帮助信息
• 发送图片 - 我会识别图片内容
• 发送位置 - 我会显示位置信息
        `);
      } else {
        message.$reply('收到你的消息：' + text);
      }
    }
  }
});

// 处理图片消息
app.on('message.receive', (message) => {
  if (message.$adapter !== 'wechat-mp') return;
  
  const hasImage = message.$content.some(seg => seg.type === 'image');
  if (hasImage) {
    message.$reply('我收到了你发送的图片，但暂时还不能处理图片内容。');
  }
});

// 处理语音消息
app.on('message.receive', (message) => {
  if (message.$adapter !== 'wechat-mp') return;
  
  for (const segment of message.$content) {
    if (segment.type === 'voice') {
      const recognition = segment.data.recognition;
      if (recognition) {
        message.$reply(`我听到你说：${recognition}`);
      } else {
        message.$reply('我收到了你的语音消息，但无法识别内容。');
      }
    }
  }
});

// 处理位置消息
app.on('message.receive', (message) => {
  if (message.$adapter !== 'wechat-mp') return;
  
  for (const segment of message.$content) {
    if (segment.type === 'location') {
      const { latitude, longitude, label } = segment.data;
      message.$reply(`你的位置信息：
位置：${label || '未知'}
坐标：${latitude}, ${longitude}
感谢分享你的位置！`);
    }
  }
});

// 处理事件消息  
app.on('message.receive', (message) => {
  if (message.$adapter !== 'wechat-mp') return;
  
  for (const segment of message.$content) {
    if (segment.type === 'event') {
      const { event, eventKey } = segment.data;
      
      switch (event) {
        case 'subscribe':
          message.$reply(`🎉 欢迎关注我们的公众号！

感谢你的关注，这里是一个基于 zhin.js 构建的智能聊天机器人。

你可以：
• 发送文字与我聊天
• 发送图片我会尝试识别  
• 发送语音我会转换为文字
• 发送位置我会显示详情
• 发送"帮助"查看更多功能

让我们开始对话吧！`);
          break;
          
        case 'unsubscribe':
          console.log('用户取消关注:', message.$sender.id);
          break;
          
        case 'CLICK':
          console.log('菜单点击事件:', eventKey);
          if (eventKey === 'MENU_HELP') {
            message.$reply('这是帮助信息...');
          }
          break;
          
        case 'VIEW':
          console.log('菜单链接事件:', eventKey);
          break;
      }
    }
  }
});

// 定期发送消息（仅用于演示，实际使用需要遵守微信推送规则）
app.on('ready', () => {
  console.log('微信公众号机器人已启动！');
  console.log(`服务器监听端口: 3000`);
  console.log(`Webhook地址: http://localhost:3000/wechat`);
  console.log(`请在微信公众平台设置此地址作为服务器URL`);
  
  // 示例：定时任务（实际使用时需要谨慎，避免触发微信限制）
  // setInterval(async () => {
  //   // 向特定用户发送消息
  //   await app.sendMessage({
  //     context: 'wechat-mp',
  //     bot: 'my-wechat-bot',
  //     id: 'user-openid',
  //     type: 'private', 
  //     content: '定期推送消息'
  //   });
  // }, 3600000); // 1小时
});

// 错误处理
app.on('error', (error) => {
  console.error('应用错误:', error);
});

// 启动应用
app.start().catch(console.error);

// 优雅退出
process.on('SIGINT', () => {
  console.log('正在关闭服务器...');
  app.stop().then(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
