import { Outlet, Link, useSelector, useDispatch, toggleSidebar, setActiveMenu } from "@zhin.js/client"
import { useMemo } from "react"
import { Menu, Search } from 'lucide-react'
import { cn } from "@zhin.js/client"
import { ThemeToggle } from "../components/ThemeToggle"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { ScrollArea } from "../components/ui/scroll-area"
import { Avatar, AvatarImage, AvatarFallback } from "../components/ui/avatar"

export default function DashboardLayout() {
    const dispatch = useDispatch()
    const sidebarOpen = useSelector(state => state.ui.sidebarOpen)
    const activeMenu = useSelector(state => state.ui.activeMenu)
    const routes = useSelector(state => state.route.routes)

    const menuItems = useMemo(() => {
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
        <div className="flex h-screen bg-background">
            {/* Sidebar */}
            <div className={cn(
                "flex flex-col border-r bg-sidebar transition-all duration-300",
                sidebarOpen ? "w-64" : "w-16"
            )}>
                {/* Logo */}
                <div className="p-4 border-b">
                    <div className={cn(
                        "flex items-center transition-all duration-300",
                        sidebarOpen ? "gap-3" : "justify-center"
                    )}>
                        <div className="flex items-center justify-center w-9 h-9 min-w-9 rounded-lg bg-foreground text-background font-bold text-lg">
                            Z
                        </div>
                        {sidebarOpen && (
                            <div className="flex flex-col">
                                <span className="text-base font-semibold">Zhin.js</span>
                                <span className="text-xs text-muted-foreground">管理控制台</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Menu */}
                <ScrollArea className="flex-1">
                    <div className="p-2 space-y-1">
                        {menuItems.map((item) => {
                            const isActive = activeMenu === item.key
                            return (
                                <Link
                                    key={item.key}
                                    to={item.href}
                                    onClick={() => dispatch(setActiveMenu(item.key))}
                                    className={cn(
                                        "menu-item",
                                        isActive && "active",
                                        !sidebarOpen && "justify-center px-2"
                                    )}
                                >
                                    <span className="shrink-0">{item.icon}</span>
                                    {sidebarOpen && <span className="truncate">{item.title}</span>}
                                </Link>
                            )
                        })}
                    </div>
                </ScrollArea>
            </div>

            {/* Main content area */}
            <div className="flex flex-col flex-1 overflow-hidden">
                {/* Top bar */}
                <header className="flex items-center justify-between h-14 px-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                    {/* Left */}
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => dispatch(toggleSidebar())}
                        >
                            <Menu className="h-5 w-5" />
                        </Button>
                        <div className="flex flex-col">
                            <h2 className="text-sm font-semibold">控制台</h2>
                            <span className="text-xs text-muted-foreground">欢迎回来</span>
                        </div>
                    </div>

                    {/* Center search */}
                    <div className="hidden md:flex flex-1 max-w-md mx-6">
                        <div className="relative w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="搜索功能、插件、设置..."
                                className="pl-9 bg-muted/50"
                            />
                        </div>
                    </div>

                    {/* Right actions */}
                    <div className="flex items-center gap-1">
                        <ThemeToggle />
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 overflow-auto">
                    <div className="max-w-7xl mx-auto p-6">
                        <Outlet />
                    </div>
                </main>
            </div>
        </div>
    )
}
