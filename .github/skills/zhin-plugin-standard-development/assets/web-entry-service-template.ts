import path from 'node:path'
import type { PageManager } from '@zhin.js/console'

export function registerWebEntry(pageManager: PageManager) {
  const clientEntry = path.resolve(import.meta.dirname, '../client/index.tsx')
  pageManager.addEntry({
    id: path.basename(path.resolve(import.meta.dirname, '..')),
    development: clientEntry,
    production: clientEntry,
  })
}
