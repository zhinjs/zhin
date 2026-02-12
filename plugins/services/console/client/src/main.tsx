import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider as ReduxProvider } from 'react-redux'
import { Home, Package, Bot, FileText } from 'lucide-react'
import { store, DynamicRouter, persistor, addPage, useSelector, useWebSocket } from '@zhin.js/client'
import DashboardLayout from './layouts/dashboard'
import DashboardHome from './pages/dashboard-home'
import DashboardPlugins from './pages/dashboard-plugins'
import DashboardPluginDetail from './pages/dashboard-plugin-detail'
import DashboardBots from './pages/dashboard-bots'
import DashboardLogs from './pages/dashboard-logs'
import './style.css'
import { PersistGate } from 'redux-persist/integration/react'
import { initializeTheme } from './theme'
import { TooltipProvider } from './components/ui/tooltip'

// Initialize theme on app load
initializeTheme()

// Route initializer component
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
                redirect: '/dashboard',
                meta: { order: 0 },
                children: [
                    {
                        key: 'dashboard-home',
                        index: true,
                        path: '',
                        title: '系统概览',
                        icon: <Home className="w-4 h-4" />,
                        element: <DashboardHome />,
                    },
                    {
                        key: 'dashboard-plugins',
                        path: '/plugins',
                        title: '插件管理',
                        icon: <Package className="w-4 h-4" />,
                        element: <DashboardPlugins />,
                        meta: { order: 2 }
                    },
                    {
                        key: 'dashboard-plugin-detail',
                        title: '插件详情',
                        path: '/plugins/:name',
                        element: <DashboardPluginDetail />,
                        meta: { hideInMenu: true }
                    },
                    {
                        key: 'dashboard-bots',
                        path: '/bots',
                        title: '机器人',
                        icon: <Bot className="w-4 h-4" />,
                        element: <DashboardBots />,
                        meta: { order: 3 }
                    },
                    {
                        key: 'dashboard-logs',
                        path: '/logs',
                        title: '系统日志',
                        icon: <FileText className="w-4 h-4" />,
                        element: <DashboardLogs />,
                        meta: { order: 4 }
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
            <PersistGate loading={null} persistor={persistor}>
                <ReduxProvider store={store}>
                    <RouteInitializer />
                </ReduxProvider>
            </PersistGate>
        </TooltipProvider>
    </StrictMode>,
)
