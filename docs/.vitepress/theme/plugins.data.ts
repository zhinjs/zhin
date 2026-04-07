import { defineLoader } from 'vitepress'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// 插件数据接口
export interface PluginInfo {
  name: string
  displayName: string
  description: string
  author: string
  isOfficial: boolean
  category: 'adapter' | 'service' | 'util' | 'game' | 'feature'
  version?: string
  npm?: string
  github?: string
  homepage?: string
  tags?: string[]
  lastUpdate?: string
  /** 下载量统计 */
  downloads?: { weekly: number; monthly: number }
  /** README 摘要（前 200 字） */
  readme?: string
  /** 许可证 */
  license?: string
  /** Node.js 引擎要求 */
  engines?: Record<string, string>
  /** 对等依赖 */
  peerDependencies?: Record<string, string>
}

// 插件统计接口
export interface PluginStats {
  total: number
  official: number
  community: number
  adapters: number
  services: number
  utils: number
  games: number
  features: number
}

// 数据加载结果类型
export interface PluginData {
  plugins: PluginInfo[]
  stats: PluginStats
  updatedAt?: string
}

// 声明导出的 data
declare const data: PluginData
export { data }

export default defineLoader({
  watch: ['../../public/plugins.json'],
  async load(): Promise<PluginData> {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const jsonPath = resolve(__dirname, '../../public/plugins.json')

    try {
      const raw = readFileSync(jsonPath, 'utf-8')
      const json = JSON.parse(raw) as PluginData
      console.log(`Plugin data loaded: ${json.stats.total} plugins (updated ${json.updatedAt || 'unknown'})`)
      return json
    } catch {
      console.warn('Failed to read plugins.json, using empty data')
      return {
        plugins: [],
        stats: { total: 0, official: 0, adapters: 0, community: 0 },
      }
    }
  },
})
