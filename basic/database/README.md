# @zhin.js/database

Universal database driver for zhin framework.

## Installation

```bash
npm install @zhin.js/database
```

## Quick Start

```typescript
import { Database } from '@zhin.js/database';
import '@zhin.js/driver-sqlite'; // 导入方言

// 创建数据库
const db = Database.create('sqlite', {
  filename: './database.sqlite'
}, {
  users: {
    id: { type: 'integer', primary: true, autoIncrement: true },
    name: { type: 'string', nullable: false },
    email: { type: 'string', unique: true }
  }
});

await db.start();

// 使用模型
const userModel = db.model('users');
const user = await userModel.create({
  name: 'John Doe',
  email: 'john@example.com'
});
```

## Supported Databases

### Relational Databases
- **SQLite**: `@zhin.js/driver-sqlite`
- **MySQL**: `@zhin.js/driver-mysql`
- **PostgreSQL**: `@zhin.js/driver-postgresql`

### NoSQL Databases
- **MongoDB**: `@zhin.js/driver-mongodb`
- **Redis**: `@zhin.js/driver-redis`

### In-Memory Database
- **Memory**: Built-in (for testing)

## Database Types

### RelatedDatabase
For relational databases (SQLite, MySQL, PostgreSQL)

```typescript
import { RelatedDatabase } from '@zhin.js/database';

const db = new RelatedDatabase(dialect, schemas);
```

### DocumentDatabase
For document databases (MongoDB)

```typescript
import { DocumentDatabase } from '@zhin.js/database';

const db = new DocumentDatabase(dialect, schemas);
```

### KeyValueDatabase
For key-value stores (Redis)

```typescript
import { KeyValueDatabase } from '@zhin.js/database';

const db = new KeyValueDatabase(dialect, schemas);
```

## Features

- **Type Safety**: Full TypeScript support
- **Unified API**: Same interface for all database types
- **Query Builder**: Fluent query building
- **Schema Management**: Automatic table/collection creation
- **Connection Management**: Automatic connection handling
- **Transaction Support**: Built-in transaction support
- **Migration Support**: Schema evolution support

## License

MIT
