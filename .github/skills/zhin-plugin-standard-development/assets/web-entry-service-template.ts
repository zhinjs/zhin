import path from 'node:path'
import { PageManager } from '@zhin.js/console'

export function registerWebEntry() {
  const clientEntry = path.resolve(import.meta.dirname, '../client/index.tsx')
  PageManager.addEntry({
    id: path.basename(path.resolve(import.meta.dirname, '..')),
    development: clientEntry,
    production: clientEntry,
  })
}
