import { app } from '@zhin.js/client'
import HomePage from './pages/dashboard'
import PluginsPage from './pages/plugins'
import PluginDetailPage from './pages/plugin-detail'
import BotManagePage from './pages/bots'
import BotDetailPage from './pages/bot-detail'
import LogsPage from './pages/logs'
import ConfigPage from './pages/config'
import EnvManagePage from './pages/env'
import FileManagePage from './pages/files'
import DatabasePage from './pages/database/database-page'
import CronPage from './pages/cron'
import MarketplacePage from './pages/marketplace'

export function registerBuiltinConsolePages() {
  app.addRoute({
    path: '/console/dashboard',
    name: '系统概览',
    parent: '/console',
    icon: 'Home',
    element: <HomePage />,
    meta: { group: '系统', order: 0 },
  })

  app.addRoute({
    path: '/console/bots',
    name: '机器人',
    parent: '/console',
    icon: 'Bot',
    element: <BotManagePage />,
    meta: { group: '系统', order: 1 },
  })

  app.addRoute({
    path: '/console/logs',
    name: '系统日志',
    parent: '/console',
    icon: 'FileText',
    element: <LogsPage />,
    meta: { group: '系统', order: 2, fullWidth: true },
  })

  app.addRoute({
    path: '/console/cron',
    name: '定时任务',
    parent: '/console',
    icon: 'Clock',
    element: <CronPage />,
    meta: { group: '系统', order: 3 },
  })

  app.addRoute({
    path: '/console/plugins',
    name: '插件管理',
    parent: '/console',
    icon: 'Package',
    element: <PluginsPage />,
    meta: { group: '扩展', order: 4 },
  })

  app.addRoute({
    path: '/console/plugins/:name',
    name: '插件详情',
    parent: '/console',
    element: <PluginDetailPage />,
    meta: { hideInMenu: true },
  })

  app.addRoute({
    path: '/console/marketplace',
    name: '插件市场',
    parent: '/console',
    icon: 'Store',
    element: <MarketplacePage />,
    meta: { group: '扩展', order: 5 },
  })

  app.addRoute({
    path: '/console/config',
    name: '配置管理',
    parent: '/console',
    icon: 'Settings',
    element: <ConfigPage />,
    meta: { group: '配置与数据', order: 6 },
  })

  app.addRoute({
    path: '/console/env',
    name: '环境变量',
    parent: '/console',
    icon: 'KeyRound',
    element: <EnvManagePage />,
    meta: { group: '配置与数据', order: 6 },
  })

  app.addRoute({
    path: '/console/files',
    name: '文件管理',
    parent: '/console',
    icon: 'FolderOpen',
    element: <FileManagePage />,
    meta: { group: '配置与数据', order: 7 },
  })

  app.addRoute({
    path: '/console/database',
    name: '数据库',
    parent: '/console',
    icon: 'Database',
    element: <DatabasePage />,
    meta: { group: '配置与数据', order: 8, fullWidth: true },
  })

  app.addRoute({
    path: '/console/bots/:adapter/:botId',
    name: '机器人详情',
    parent: '/console',
    element: <BotDetailPage />,
    meta: { hideInMenu: true, fullWidth: true },
  })
}
