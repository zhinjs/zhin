import path from 'node:path'

export function registerWebEntry(web: any) {
  return web.addEntry(path.resolve(import.meta.dirname, '../client/index.tsx'))
}