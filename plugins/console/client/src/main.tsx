import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider as ReduxProvider } from 'react-redux'
import { store, DynamicRouter, persistor, addPage, useSelector, Icons } from '@zhin.js/client'
import DashboardLayout from './layouts/dashboard'
import DashboardHome from './pages/dashboard-home'
import DashboardPlugins from './pages/dashboard-plugins'
import DashboardPluginDetail from './pages/dashboard-plugin-detail'
import DashboardBots from './pages/dashboard-bots'
import DashboardLogs from './pages/dashboard-logs'
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css'
import './style.css'
import { PersistGate } from 'redux-persist/integration/react'
import { initializeTheme } from './theme'

// Initialize theme on app load
initializeTheme()


// 路由配置
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
                icon: <Icons.Home className="w-5 h-5" />,
                element: <DashboardHome />,
            },

             {
                 key: 'dashboard-plugins',
                 path: '/plugins',
                 title: '插件管理',
                 icon: <Icons.Package className="w-5 h-5" />,
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
                icon: <Icons.Bot className="w-5 h-5" />,
                element: <DashboardBots />,
                meta: { order: 3 }
            },
            {
                key: 'dashboard-logs',
                path: '/logs',
                title: '系统日志',
                icon: <Icons.FileText className="w-5 h-5" />,
                element: <DashboardLogs />,
                meta: { order: 4 }
            }
        ]
    }
]

// 路由初始化组件
function RouteInitializer() {
    const entries = useSelector(state => state.script.entries)
    const loadedScripts = useSelector(state => state.script.loadedScripts)
    const [staticRoutesLoaded, setStaticRoutesLoaded] = useState(false)

    useEffect(() => {
        // 添加静态路由
        routes.forEach(route => {
            addPage(route)
        })
        setStaticRoutesLoaded(true)
    }, [])

    // 检查是否所有脚本都已加载
    const allScriptsLoaded = entries.length === 0 || entries.length === loadedScripts.length

    // 等待静态路由和动态脚本都加载完成
    if (!staticRoutesLoaded || !allScriptsLoaded) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                    <p className="mt-2 text-gray-600">
                        加载中... ({loadedScripts.length}/{entries.length})
                    </p>
                </div>
            </div>
        )
    }

    return <DynamicRouter />
}

createRoot(
    document.getElementById('root'),
).render(
    <StrictMode>
        <Theme accentColor="blue" grayColor="slate" radius="large" scaling="100%">
            <PersistGate loading={null} persistor={persistor}>
                <ReduxProvider store={store}>
                    <RouteInitializer />
                </ReduxProvider>
            </PersistGate>
        </Theme>
    </StrictMode>,
)