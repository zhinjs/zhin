import {addCommand, onDispose, onPrivateMessage,requireContext, type Message, onMounted } from '../app';
import { Database } from './demo-plugin';

// 声明需要的 Context
requireContext('database');
requireContext('cache');

// 初始化插件
onMounted(async (plugin) => {
  const db = plugin.useContext<Database>('database')!.value!;
  const results = await db.query('SELECT * FROM users');
  console.log('Query results:', results);
});

// 注册命令
addCommand('test2', () => {
  console.log('Command test2 executed')
});

onPrivateMessage((message: Message) => {
  console.log('Private message:', message);
});

onDispose(() => {
  console.log('demo-plugin1 disposed');
});

console.log('demo-plugin1 loaded');