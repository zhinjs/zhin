import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider as ReduxProvider } from 'react-redux'
import { Home, Package, Bot, FileText, Settings, KeyRound, FolderOpen, Database } from 'lucide-react'
import { store, DynamicRouter, persistor, addPage, useSelector, useWebSocket } from '@zhin.js/client'
import DashboardLayout from './layouts/dashboard'
import HomePage from './pages/dashboard'
import PluginsPage from './pages/plugins'
import PluginDetailPage from './pages/plugin-detail'
import BotMangePage from './pages/bots'
import LogsPage from './pages/logs'
import ConfigPage from './pages/config'
import EnvMangePage from './pages/env'
import FileMangePage from './pages/files'
import DatabasePage from './pages/database'
import LoginPage from './pages/login'
import { hasToken } from './utils/auth'
import './style.css'
import { PersistGate } from 'redux-persist/integration/react'
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
        <PersistGate loading={null} persistor={persistor}>
            <ReduxProvider store={store}>
                <RouteInitializer />
            </ReduxProvider>
        </PersistGate>
    )
}

function RouteInitializer() {
    useWebSocket()

    const entries = useSelector(state => state.script.entries)
    const loadedScripts = useSelector(state => state.script.loadedScripts)
    const synced = useSelector(state => state.script.synced)
    const [initialized, setInitialized] = useState(false)

    useEffect(() => {
        const routes = [
            {
                key: 'dashboard-layout',
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
                    },
                    {
                        key: 'pluginsPage',
                        path: '/plugins',
                        title: '插件管理',
                        icon: <Package className="w-4 h-4" />,
                        element: <PluginsPage />,
                        meta: { order: 2 }
                    },
                    {
                        key: 'pluginDetailPage',
                        title: '插件详情',
                        path: '/plugins/:name',
                        element: <PluginDetailPage />,
                        meta: { hideInMenu: true }
                    },
                    {
                        key: 'configPage',
                        path: '/config',
                        title: '配置管理',
                        icon: <Settings className="w-4 h-4" />,
                        element: <ConfigPage />,
                        meta: { order: 3 }
                    },
                    {
                        key: 'envManagePage',
                        path: '/env',
                        title: '环境变量',
                        icon: <KeyRound className="w-4 h-4" />,
                        element: <EnvMangePage />,
                        meta: { order: 4 }
                    },
                    {
                        key: 'fileManagePage',
                        path: '/files',
                        title: '文件管理',
                        icon: <FolderOpen className="w-4 h-4" />,
                        element: <FileMangePage />,
                        meta: { order: 5 }
                    },
                    {
                        key: 'databasePage',
                        path: '/database',
                        title: '数据库',
                        icon: <Database className="w-4 h-4" />,
                        element: <DatabasePage />,
                        meta: { order: 6 }
                    },
                    {
                        key: 'botManagePage',
                        path: '/bots',
                        title: '机器人',
                        icon: <Bot className="w-4 h-4" />,
                        element: <BotMangePage />,
                        meta: { order: 7 }
                    },
                    {
                        key: 'logsPage  ',
                        path: '/logs',
                        title: '系统日志',
                        icon: <FileText className="w-4 h-4" />,
                        element: <LogsPage />,
                        meta: { order: 8 }
                    }
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
