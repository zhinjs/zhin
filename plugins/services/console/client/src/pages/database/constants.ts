import type { DatabaseType } from '@zhin.js/client'

export const DB_TYPE_LABELS: Record<DatabaseType, string> = {
  related: '关系型',
  document: '文档型',
  keyvalue: '键值型',
}

export const DIALECT_LABELS: Record<string, string> = {
  sqlite: 'SQLite',
  mysql: 'MySQL',
  pg: 'PostgreSQL',
  memory: 'Memory',
  mongodb: 'MongoDB',
  redis: 'Redis',
}
