import { defineLoader } from 'vitepress'

// 插件数据接口
export interface PluginInfo {
  name: string
  displayName: string
  description: string
  author: string
  isOfficial: boolean
  category: ('game' | 'util' | 'ai'|'framework' | 'service' | 'adapter')[]
  version?: string
  downloads?: string
  stars?: number
  npm?: string
  github?: string
  homepage?: string
  tags?: string[]
  icon?: string
  lastUpdate?: string
}

// 插件统计接口
export interface PluginStats {
  total: number
  official: number
  adapters: number
  community: number
}

// 数据加载结果类型
export interface PluginData {
  plugins: PluginInfo[]
  stats: PluginStats
}

// 声明导出的 data
declare const data: PluginData
export { data }

// npm API 响应类型
interface NpmSearchResult {
  objects: Array<{
    package: {
      publisher: {
        name: string
        username: string
      }
      name: string
      version: string
      description?: string
      keywords?: string[]
      author?: { name?: string } | string
      links?: {
        npm?: string
        homepage?: string
        repository?: string
      }
      date?: string
    }
  }>
}

// 根据关键词自动判断分类
function getPluginCategory(pkg: {
  name: string
  keywords?: string[]
}): PluginInfo['category'] {
  const name = pkg.name.toLowerCase()
  const result: PluginInfo['category'] = []
  const keywords = (pkg.keywords || []).map(k => k.toLowerCase())
  if (keywords.some(k => k.includes('adapter'))) {
    result.push('adapter')
  }
  if (keywords.some(k => k.includes('service'))) {
    result.push('service')
  }
  if (keywords.some(k => k.includes('ai'))) {
    result.push('ai')
  }
  if (keywords.some(k => k.includes('game'))) {
    result.push('game')
  }
  if (keywords.some(k => k.includes('util'))) {
    result.push('util')
  }
  return result
}

// 插件图标映射
const pluginIcons: Record<string, string> = {
  '@zhin.js/core': '⚡',
  '@zhin.js/console': '🖥️',
  '@zhin.js/http': '🌐',
  '@zhin.js/adapter-icqq': '🐧',
  '@zhin.js/adapter-kook': '🎮',
  '@zhin.js/adapter-onebot11': '🤖',
  '@zhin.js/adapter-discord': '💬',
  '@zhin.js/adapter-telegram': '✈️',
  '@zhin.js/adapter-process': '⚙️',
}

// 从 npm 搜索插件
async function fetchPluginsFromNpm(): Promise<PluginInfo[]> {
  try {
    // 搜索 @zhin.js 官方包（直接搜索包名）
    const officialResponse = await fetch(
      'https://registry.npmjs.org/-/v1/search?text=@zhin.js&size=50'
    )
    
    // 搜索社区插件（搜索 zhin.js 关键词）
    const communityResponse = await fetch(
      'https://registry.npmjs.org/-/v1/search?text=zhin.js+plugin&size=50'
    )
    
    if (!officialResponse.ok || !communityResponse.ok) {
      console.warn('Failed to fetch from npm, using fallback data')
      return getFallbackPlugins()
    }
    
    const officialData: NpmSearchResult = await officialResponse.json()
    const communityData: NpmSearchResult = await communityResponse.json()
    
    // 合并并去重
    const allPackages = [
      ...officialData.objects,
      ...communityData.objects
    ]
    
    // 去重（按包名）
    const uniquePackages = Array.from(
      new Map(allPackages.map(obj => [obj.package.name, obj])).values()
    )
    
    // 转换为 PluginInfo 格式
    const plugins: PluginInfo[] = uniquePackages
    .filter(obj => obj.package.name.startsWith('@zhin.js/') || obj.package.name.startsWith('zhin.js-'))
      .map(obj => {
        const pkg = obj.package
        const isOfficial = pkg.name.startsWith('@zhin.js/')
        // 提取作者信息
        let author = 'Unknown'
        if (typeof pkg.publisher === 'string') {
          author = pkg.publisher
        } else if (pkg.publisher?.username) {
          author = pkg.publisher.username
        }else if (typeof pkg.author === 'string') {
          author = pkg.author
        }else if (pkg.author?.name) {
          author = pkg.author.name
        }
        // 自动判断分类（根据规则）
        const category = getPluginCategory({
          name: pkg.name,
          keywords: pkg.keywords
        })
        // 生成显示名称
        const displayName = pkg.name.startsWith('@zhin.js/')
          ? pkg.name.replace('@zhin.js/', '').replace('adapter-', '')
          : pkg.name.replace('zhin.js-', '')
        
        return {
          name: pkg.name,
          displayName,
          description: pkg.description || '无描述',
          author: author,
          isOfficial: isOfficial,
          category: category,
          version: pkg.version,
          npm: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
          github: pkg.links?.repository,
          homepage: pkg.links?.homepage,
          tags: pkg.keywords || [],
          icon: pluginIcons[pkg.name] || (isOfficial ? '✨' : '📦'),
          lastUpdate: pkg.date
        }
      })
      // 过滤掉不相关的包
      .filter(plugin => {
        const name = plugin.name.toLowerCase()
        const description = plugin.description.toLowerCase()
        const tags = plugin.tags.map(t => t.toLowerCase())
        
        // 官方包：必须是 @zhin.js/ 开头
        if (name.startsWith('@zhin.js/')) return true
        
        // 社区包：必须满足以下条件之一
        // 1. 包名以 zhin.js- 开头
        if (name.startsWith('zhin.js-')) return true
        
        // 2. 包含 zhin 或 zhin.js 关键词
        const hasZhinKeyword = tags.some(tag => tag === 'zhin' || tag === 'zhin.js')
        
        // 3. 描述或包名中明确提到 zhin
        const mentionsZhin = name.includes('zhin') || description.includes('zhin')
        
        return hasZhinKeyword && mentionsZhin
      })
    
    console.log(`✅ 从 npm 获取了 ${plugins.length} 个插件`)
    return plugins
    
  } catch (error) {
    console.error('❌ 从 npm 获取插件失败:', error)
    return getFallbackPlugins()
  }
}

// 备用静态数据（当 npm API 失败时使用）
function getFallbackPlugins(): PluginInfo[] {
  return [
  // 官方插件
  {
    name: '@zhin.js/core',
    displayName: 'Core',
    description: 'Zhin.js 核心框架',
    author: 'Zhin Team',
    isOfficial: true,
    category: ['framework'],
    npm: 'https://www.npmjs.com/package/@zhin.js/core',
    github: 'https://github.com/zhinjs/zhin/tree/main/packages/core',
    icon: '⚡',
    tags: ['核心', '框架']
  },
  {
    name: '@zhin.js/console',
    displayName: 'Console',
    description: 'Web 管理控制台',
    author: 'Zhin Team',
    isOfficial: true,
    category: ['framework', 'service'],
    npm: 'https://www.npmjs.com/package/@zhin.js/console',
    github: 'https://github.com/zhinjs/zhin/tree/main/plugins/services/console',
    icon: '🖥️',
    tags: ['管理', '控制台', 'Web']
  },
  {
    name: '@zhin.js/http',
    displayName: 'HTTP',
    description: 'HTTP 服务支持',
    author: 'Zhin Team',
    isOfficial: true,
    category: ['framework', 'service'],
    npm: 'https://www.npmjs.com/package/@zhin.js/http',
    github: 'https://github.com/zhinjs/zhin/tree/main/plugins/services/http',
    icon: '🌐',
    tags: ['HTTP', '服务']
  },
  
  // 适配器插件
  {
    name: '@zhin.js/adapter-icqq',
    displayName: 'ICQQ Adapter',
    description: 'QQ 平台适配器（基于 ICQQ）',
    author: 'Zhin Team',
    isOfficial: true,
    category: ['adapter'],
    npm: 'https://www.npmjs.com/package/@zhin.js/adapter-icqq',
    github: 'https://github.com/zhinjs/zhin/tree/main/plugins/adapters/icqq',
    icon: '🐧',
    tags: ['QQ', '适配器', 'ICQQ']
  },
  {
    name: '@zhin.js/adapter-kook',
    displayName: 'KOOK Adapter',
    description: 'KOOK 平台适配器',
    author: 'Zhin Team',
    isOfficial: true,
    category: ['adapter'],
    npm: 'https://www.npmjs.com/package/@zhin.js/adapter-kook',
    github: 'https://github.com/zhinjs/zhin/tree/main/plugins/adapters/kook',
    icon: '🎮',
    tags: ['KOOK', '适配器']
  },
  {
    name: '@zhin.js/adapter-onebot11',
    displayName: 'OneBot v11 Adapter',
    description: 'OneBot v11 协议适配器',
    author: 'Zhin Team',
    isOfficial: true,
    category: ['adapter'],
    npm: 'https://www.npmjs.com/package/@zhin.js/adapter-onebot11',
    github: 'https://github.com/zhinjs/zhin/tree/main/plugins/adapters/onebot11',
    icon: '🤖',
    tags: ['OneBot', '适配器', '协议']
  },
  {
    name: '@zhin.js/adapter-discord',
    displayName: 'Discord Adapter',
    description: 'Discord 平台适配器',
    author: 'Zhin Team',
    isOfficial: true,
    category: ['adapter'],
    npm: 'https://www.npmjs.com/package/@zhin.js/adapter-discord',
    github: 'https://github.com/zhinjs/zhin/tree/main/plugins/adapters/discord',
    icon: '💬',
    tags: ['Discord', '适配器']
  },

  // 示例社区插件（这些可以后续从 npm API 动态获取）
  {
    name: 'zhin.js-example',
    displayName: '示例插件',
    description: '这是一个示例插件，展示如何开发 Zhin.js 插件',
    author: '社区开发者',
    isOfficial: false,
    category: ['util'],
    icon: '📦',
    tags: ['示例', '教程']
  },
  ]
}

// 计算统计数据
function calculateStats(plugins: PluginInfo[]): PluginStats {
  // official: scope === @zhin.js
  const officialPlugins = plugins.filter(p => p.name.startsWith('@zhin.js/'))
  
  // adapter: keyword includes adapter（包含官方和社区）
  const adapterPlugins = plugins.filter(p => p.category.includes('adapter'))
  
  // community: name startsWith zhin.js-
  const communityPlugins = plugins.filter(p => p.name.startsWith('zhin.js-'))
  
  return {
    total: plugins.length,
    official: officialPlugins.length,
    adapters: adapterPlugins.length,
    community: communityPlugins.length
  }
}

export default defineLoader({
  async load(): Promise<PluginData> {
    console.log('🔄 开始从 npm 获取插件数据...')
    
    // 从 npm API 获取实时插件数据
    const plugins = await fetchPluginsFromNpm()
    
    // 按分类和名称排序
    const sortedPlugins = plugins.sort((a, b) => {
      // 官方插件优先
      if (a.name.startsWith('@zhin.js/') && !b.name.startsWith('@zhin.js/')) return -1
      if (!a.name.startsWith('@zhin.js/') && b.name.startsWith('@zhin.js/')) return 1
      // 同类按名称排序
      return a.name.localeCompare(b.name)
    })
    
    const stats = calculateStats(sortedPlugins)
    
    console.log('✅ 插件数据加载完成:', {
      total: stats.total,
      official: stats.official,
      adapters: stats.adapters,
      community: stats.community
    })
    
    return {
      plugins: sortedPlugins,
      stats
    }
  }
})

