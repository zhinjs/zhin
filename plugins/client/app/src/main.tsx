import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { store, DynamicRouter, persistor, addPage, useSelector } from '@zhin.js/client'
import DashboardLayout from './layouts/dashboard'
import DashboardHome from './pages/dashboard-home' 
import './style.css'
import { PersistGate } from 'redux-persist/integration/react'
import { Home } from 'lucide-react'


// 路由配置
const routes = [
    {
        key: 'dashboard-layout',
        path: '/',
        title: 'Dashboard',
        element: <DashboardLayout />,
        meta: { order: 0 },
        children: [
            {
                index: true,
                key: 'dashboard',
                path: '/dashboard',
                title: '仪表盘',
                icon: <Home className="w-5 h-5" />,
                element: <DashboardHome />,
                meta: { order: 1 }
            }
        ]
    },
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
        <PersistGate loading={null} persistor={persistor}>
            <Provider store={store}>
                <RouteInitializer />
            </Provider>
        </PersistGate>
    </StrictMode>,
)