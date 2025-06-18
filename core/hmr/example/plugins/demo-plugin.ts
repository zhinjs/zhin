import { onGroupMessage, onPrivateMessage, addCommand, type Message, onDispose, onMounted, createContext} from '../app';
import './demo-plugin1';
// 定义数据库 Context
export class Database {
  private connection: any;

  async connect() {
    console.log('Connecting to database...');
    this.connection = { query: async (sql: string) => [{ id: 1, name: 'test' }] };
  }

  async query(sql: string) {
    return await this.connection.query(sql);
  }

  dispose() {
    console.log('Closing database connection...');
    this.connection = null;
  }
}

// 定义缓存 Context
export class Cache {
  private cache = new Map<string, any>();

  set(key: string, value: any) {
    this.cache.set(key, value);
  }

  get(key: string) {
    return this.cache.get(key);
  }

  dispose() {
    this.cache.clear();
    this.cache = new Map(); // 创建新的 Map 以释放内存
  }
}
// 创建数据库 Context
createContext<Database>({
  name: 'database',
  async mounted(){
    const db = new Database();
    await db.connect();
    console.log('Database initialized');
    return db;
  },
  dispose(db){
    if (db) {
      db.dispose();
      console.log('Database disposed');
    }
  }
});

// 创建缓存 Context
createContext<Cache>({
  name: 'cache',
  mounted(){
    return new Cache();
  },
  dispose(cache){
    if (cache) {
      cache.dispose();
      console.log('Cache disposed');
    }
  }
});

onMounted(async(plugin)=>{
  const db = plugin.useContext<Database>('database').value!;
  const result = await db.query('SELECT * FROM users');
  console.log('Database result:', result);
});
// 注册消息处理器
onGroupMessage((message: Message) => {
  console.log('Group message:', message);
});

onPrivateMessage((message: Message) => {
  console.log('Private message:', message);
});

// 注册命令
addCommand('test', () => {
  console.log('Command test executed');
});

console.log('demo-plugin loaded');

onDispose(() => {
  console.log('demo-plugin disposed');
});