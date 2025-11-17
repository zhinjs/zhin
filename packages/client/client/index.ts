import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
// Types
export * from './types'

// Redux Store
export * from './store'

// Router
export * from './router'

// WebSocket
export * from './websocket'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
