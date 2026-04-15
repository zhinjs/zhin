import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { EnhancedStore } from '@reduxjs/toolkit'
import { Provider as ReduxProvider } from 'react-redux'
import { Home, Package, Bot, FileText, Settings, KeyRound, FolderOpen, Database, Clock, Store } from 'lucide-react'
import { store, DynamicRouter, addPage, useSelector, useWebSocket, type RootState } from '@zhin.js/client'
import DashboardLayout from './layouts/dashboard'
import HomePage from './pages/dashboard'
import PluginsPage from './pages/plugins'
import PluginDetailPage from './pages/plugin-detail'
import BotManagePage from './pages/bots'
import BotDetailPage from './pages/bot-detail'
import LogsPage from './pages/logs'
import ConfigPage from './pages/config'
import EnvManagePage from './pages/env'
import FileManagePage from './pages/files'
import DatabasePage from './pages/database'
import CronPage from './pages/cron'
import MarketplacePage from './pages/marketplace'
import LoginPage from './pages/login'
import { hasToken } from './utils/auth'
import './style.css'
import { initializeTheme } from './theme'
import { TooltipProvider } from './components/ui/tooltip'

// Initialize theme on app load
initializeTheme()

// Auth guard + route initializer
function App() {
    const [authed, setAuthed] = useState(hasToken())

    const handleLogin = useCallback(() => setAuthed(true), [])

    useEffect(() => {
        const onAuthRequired = () => setAuthed(false)
        window.addEventListener('zhin:auth-required', onAuthRequired)
        return () => window.removeEventListener('zhin:auth-required', onAuthRequired)
    }, [])

    if (!authed) {
        return <LoginPage onSuccess={handleLogin} />
    }

    return (
        <ReduxProvider store={store as EnhancedStore<RootState>}>
            <RouteInitializer />
        </ReduxProvider>
    )
}

function RouteInitializer() {
    useWebSocket()

    const entries = useSelector(state => state.script?.entries || [])
    const loadedScripts = useSelector(state => state.script?.loadedScripts || [])
    const synced = useSelector(state => state.script?.synced ?? false)
    const [initialized, setInitialized] = useState(false)

    useEffect(() => {
        const routes = [
            {
                key: 'dashboardLayout',
                path: '/',
                title: 'Dashboard',
                element: <DashboardLayout />,
                meta: { order: 0 },
                children: [
                    {
                        key: 'homePage',
                        path: '/dashboard',
                        title: '系统概览',
                        icon: <Home className="w-4 h-4" />,
                        element: <HomePage />,
                        meta: { group: '系统', order: 0 },
                    },
                    {
                        key: 'botManagePage',
                        path: '/bots',
                        title: '机器人',
                        icon: <Bot className="w-4 h-4" />,
                        element: <BotManagePage />,
                        meta: { group: '系统', order: 1 },
                    },
                    {
                        key: 'logsPage',
                        path: '/logs',
                        title: '系统日志',
                        icon: <FileText className="w-4 h-4" />,
                        element: <LogsPage />,
                        meta: { group: '系统', order: 2, fullWidth: true },
                    },
                    {
                        key: 'cronPage',
                        path: '/cron',
                        title: '定时任务',
                        icon: <Clock className="w-4 h-4" />,
                        element: <CronPage />,
                        meta: { group: '系统', order: 3 },
                    },
                    {
                        key: 'pluginsPage',
                        path: '/plugins',
                        title: '插件管理',
                        icon: <Package className="w-4 h-4" />,
                        element: <PluginsPage />,
                        meta: { group: '扩展', order: 4 },
                    },
                    {
                        key: 'pluginDetailPage',
                        title: '插件详情',
                        path: '/plugins/:name',
                        element: <PluginDetailPage />,
                        meta: { hideInMenu: true },
                    },
                    {
                        key: 'marketplacePage',
                        path: '/marketplace',
                        title: '插件市场',
                        icon: <Store className="w-4 h-4" />,
                        element: <MarketplacePage />,
                        meta: { group: '扩展', order: 5 },
                    },
                    {
                        key: 'configPage',
                        path: '/config',
                        title: '配置管理',
                        icon: <Settings className="w-4 h-4" />,
                        element: <ConfigPage />,
                        meta: { group: '配置与数据', order: 6 },
                    },
                    {
                        key: 'envManagePage',
                        path: '/env',
                        title: '环境变量',
                        icon: <KeyRound className="w-4 h-4" />,
                        element: <EnvManagePage />,
                        meta: { group: '配置与数据', order: 6 },
                    },
                    {
                        key: 'fileManagePage',
                        path: '/files',
                        title: '文件管理',
                        icon: <FolderOpen className="w-4 h-4" />,
                        element: <FileManagePage />,
                        meta: { group: '配置与数据', order: 7 },
                    },
                    {
                        key: 'databasePage',
                        path: '/database',
                        title: '数据库',
                        icon: <Database className="w-4 h-4" />,
                        element: <DatabasePage />,
                        meta: { group: '配置与数据', order: 8, fullWidth: true },
                    },
                    {
                        key: 'botDetailPage',
                        path: '/bots/:adapter/:botId',
                        title: '机器人详情',
                        element: <BotDetailPage />,
                        meta: { hideInMenu: true, fullWidth: true },
                    },
                ]
            }
        ]

        routes.forEach(route => {
            addPage(route)
        })
        setInitialized(true)
    }, [])

    const allScriptsLoaded = synced && (entries.length === 0 || entries.length === loadedScripts.length)

    if (!initialized || !allScriptsLoaded) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground border-t-foreground"></div>
                    <p className="mt-3 text-sm text-muted-foreground">
                        加载中... ({loadedScripts.length}/{entries.length})
                    </p>
                </div>
            </div>
        )
    }

    return <DynamicRouter />
}

createRoot(
    document.getElementById('root')!,
).render(
    <StrictMode>
        <TooltipProvider>
            <App />
        </TooltipProvider>
    </StrictMode>,
)
