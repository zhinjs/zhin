import { Outlet, Link, useSelector, useDispatch, toggleSidebar, setActiveMenu, useWebSocket } from "@zhin.js/client"
import React from "react"
import {Avatar,DropdownMenu,} from 'radix-ui'
import {Button,Badge,TextField} from '@radix-ui/themes'
import { Icons, cn } from "@zhin.js/client"
import { useMemo } from "react"
import { ThemeToggle } from "../components/ThemeToggle"

export default function DashboardLayout() {
    const dispatch = useDispatch()
    const ws = useWebSocket()
    const sidebarOpen = useSelector(state => state.ui.sidebarOpen)
    const activeMenu = useSelector(state => state.ui.activeMenu)
    const routes = useSelector(state => state.route.routes)
    const menuItems = useMemo(() => {
        // 找到 dashboard 路由
        const dashboardRoute = routes.find(route => route.key === 'dashboard-layout')
        if (!dashboardRoute || !dashboardRoute.children) {
            return []
        }
        return dashboardRoute.children
            .filter(route => !route.meta?.hideInMenu && route.key !== 'dashboard-layout')
            .map((route, index) => ({
                key: route.key || `menu-item-${index}`,
                title: route.title,
                index: route.index,
                icon: route.icon,
                href: route.path
            }))
    }, [routes])

    return (
        <div className="flex h-screen bg-gradient-to-br from-gray-50 to-gray-100">
            {/* 现代化侧边栏 */}
            <aside 
                className={cn(
                    "bg-white/80 backdrop-blur-xl border-r border-gray-200/50 transition-all duration-300 shadow-xl flex flex-col",
                    sidebarOpen ? "w-64" : "w-20"
                )}
            >
                {/* Logo 区域 - 现代化设计 */}
                <div className="p-4 border-b border-gray-200/50">
                    <div className={cn(
                        "flex items-center transition-all duration-300",
                        sidebarOpen ? "space-x-3" : "justify-center"
                    )}>
                        <div className="w-11 h-11 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
                            <span className="text-white font-bold text-lg">Z</span>
                        </div>
                        {sidebarOpen && (
                            <div>
                                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                                    Zhin.js
                                </h1>
                                <p className="text-xs text-gray-500">管理控制台</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 侧边栏内容 - 现代化菜单 */}
                <nav className="flex-1 px-3 py-4 overflow-y-auto">
                    <div className="space-y-1.5">
                        {menuItems.map((item) => {
                            const isActive = activeMenu === item.key
                            return (
                                <Link
                                    key={item.key}
                                    to={item.href}
                                    onClick={() => dispatch(setActiveMenu(item.key))}
                                    className={cn(
                                        "flex items-center space-x-3 px-3.5 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden",
                                        isActive 
                                            ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-md" 
                                            : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                                    )}
                                >
                                    {isActive && (
                                        <div className="absolute inset-0 bg-gradient-to-r from-blue-400/10 to-purple-400/10" />
                                    )}
                                    {item.icon && React.isValidElement(item.icon) && (
                                        <div className={cn(
                                            "w-5 h-5 flex-shrink-0 relative z-10 transition-transform",
                                            !isActive && "group-hover:scale-110"
                                        )}>
                                            {item.icon}
                                        </div>
                                    )}
                                    {sidebarOpen && (
                                        <span className="font-medium whitespace-nowrap relative z-10 text-sm">{item.title}</span>
                                    )}
                                    {isActive && sidebarOpen && (
                                        <div className="ml-auto relative z-10">
                                            <div className="w-1.5 h-1.5 bg-white rounded-full" />
                                        </div>
                                    )}
                                </Link>
                            )
                        })}
                    </div>
                </nav>

                {/* 侧边栏底部 - 现代化用户卡片 */}
                <div className="p-3 border-t border-gray-200/50">
                    <div className={cn(
                        "flex items-center space-x-3 p-2.5 rounded-xl bg-gray-50/50 hover:bg-gray-100/80 transition-all duration-200 cursor-pointer",
                        !sidebarOpen && "justify-center"
                    )}>
                        <Avatar.Root className="h-8 w-8 ring-2 ring-gray-200">
                            <Avatar.Image src="https://i.pravatar.cc/150?u=admin" alt="管理员" />
                            <Avatar.Fallback>管</Avatar.Fallback>
                        </Avatar.Root>
                        {sidebarOpen && (
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-900 truncate">管理员</p>
                                <p className="text-xs text-gray-500 truncate">admin@zhin.com</p>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {/* 主内容区域 */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* 现代化顶部导航栏 */}
                <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-sm">
                    <div className="flex items-center justify-between px-6 py-4">
                        {/* 左侧 */}
                        <div className="flex items-center space-x-4">
                            <Button
                                variant="ghost"
                                size="1"
                                onClick={() => dispatch(toggleSidebar())}
                                className="hover:bg-gray-100 rounded-xl transition-colors"
                            >
                                <Icons.Menu className="w-5 h-5 text-gray-600" />
                            </Button>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">控制台</h2>
                                <p className="text-xs text-gray-500">欢迎回来！</p>
                            </div>
                        </div>

                        {/* 中间 - 搜索栏 */}
                        <div className="hidden md:flex flex-1 max-w-xl mx-8">
                            <div className="relative w-full">
                                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <TextField.Root
                                    placeholder="搜索功能、用户、设置..."
                                    className="pl-10 bg-gray-100/50"
                                />
                            </div>
                        </div>

                        {/* 右侧 */}
                        <div className="flex items-center space-x-3">
                            {/* 主题切换 */}
                            <ThemeToggle />

                            {/* 通知按钮 */}
                            <div className="relative">
                                <Button 
                                    variant="ghost"
                                    size="1"
                                    className="hover:bg-gray-100 rounded-xl"
                                >
                                    <Icons.Bell className="w-5 h-5 text-gray-600" />
                                </Button>
                                <Badge 
                                    variant="soft"
                                    className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px]"
                                >
                                    3
                                </Badge>
                            </div>

                            {/* 用户菜单 */}
                            <DropdownMenu.Root>
                                <DropdownMenu.Trigger asChild>
                                    <button className="flex items-center space-x-3 px-3 py-2 rounded-2xl hover:bg-gray-100 transition-colors focus:outline-none">
                                        <Avatar.Root className="h-8 w-8 ring-2 ring-blue-500/20">
                                            <Avatar.Image src="https://i.pravatar.cc/150?u=admin" alt="管理员" />
                                            <Avatar.Fallback>管</Avatar.Fallback>
                                        </Avatar.Root>
                                        <div className="hidden lg:block text-left">
                                            <p className="text-sm font-semibold text-gray-900">管理员</p>
                                            <p className="text-xs text-gray-500">admin@zhin.com</p>
                                        </div>
                                    </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content align="end" className="w-56">
                                    <div className="px-3 py-3 border-b border-gray-200">
                                        <p className="text-sm font-semibold">登录为</p>
                                        <p className="text-xs text-gray-600">admin@zhin.com</p>
                                    </div>
                                    <DropdownMenu.Item>
                                        <Icons.User className="mr-2 h-4 w-4" />
                                        <span>我的设置</span>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item>
                                        <Icons.Users className="mr-2 h-4 w-4" />
                                        <span>团队设置</span>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item>
                                        <Icons.BarChart3 className="mr-2 h-4 w-4" />
                                        <span>数据分析</span>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item>
                                        <Icons.HelpCircle className="mr-2 h-4 w-4" />
                                        <span>帮助与反馈</span>
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Item className="text-red-600">
                                        <Icons.LogOut className="mr-2 h-4 w-4" />
                                        <span>退出登录</span>
                                    </DropdownMenu.Item>
                                </DropdownMenu.Content>
                            </DropdownMenu.Root>
                        </div>
                    </div>
                </header>

                {/* 主内容区域 - 现代化设计 */}
                <main className="flex-1 overflow-y-auto p-8 bg-transparent">
                    <div className="max-w-7xl mx-auto">
            <Outlet />
                    </div>
                </main>
            </div>
        </div>
    )
}