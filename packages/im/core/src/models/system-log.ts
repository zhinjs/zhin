import { Definition } from '@zhin.js/database'

export interface SystemLog {
  id?: number
  level: string
  name: string
  message: string
  source: string
  timestamp: Date
}

export const SystemLogDefinition:Definition<SystemLog>={
  id: { type: 'integer', autoIncrement: true, primary: true },
  level: { type: 'text', nullable: false },
  name: { type: 'text', nullable: false },
  message: { type: 'text', nullable: false },
  source: { type: 'text', nullable: false },
  timestamp: { type: 'date', nullable: false }
}

