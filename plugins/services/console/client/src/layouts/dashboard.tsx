import { Outlet, Link, useSelector, useDispatch, toggleSidebar, setActiveMenu, useWebSocket } from "@zhin.js/client"
import React, { useMemo } from "react"
import { Avatar, DropdownMenu } from 'radix-ui'
import * as Themes from '@radix-ui/themes'
import {Menu, Search,Bell,User,Users,BarChart3,HelpCircle,LogOut} from 'lucide-react'
import { cn } from "@zhin.js/client"
import { ThemeToggle } from "../components/ThemeToggle"

const { Box, Flex, Text, Heading, IconButton, Badge, TextField, ScrollArea, Container } = Themes

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
        <Flex className="h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
            {/* 侧边栏 */}
            <Flex
                direction="column"
                className={cn(
                    "glass transition-all duration-300 shadow-xl border-r border-gray-200/50 dark:border-gray-700/50",
                    sidebarOpen ? "w-64" : "w-20"
                )}
            >
                {/* Logo 区域 */}
                <Box p="4" className="border-b border-gray-200/50 dark:border-gray-700/50">
                    <Flex
                        align="center"
                        className={cn(
                            "transition-all duration-300",
                            sidebarOpen ? "gap-3" : "justify-center"
                        )}
                    >
                        <Flex
                            align="center"
                            justify="center"
                            className="w-11 min-w-11 h-11 rounded-xl shadow-md bg-gradient-to-br from-blue-500 to-purple-600"
                        >
                            <Text size="5" weight="bold" className="text-white">
                                Z
                            </Text>
                        </Flex>
                        {sidebarOpen && (
                            <Flex direction="column" gap="0">
                                <Heading size="4" className="text-gray-900 dark:text-gray-100">
                                    Zhin.js
                                </Heading>
                                <Text size="1" color="gray">管理控制台</Text>
                            </Flex>
                        )}
                    </Flex>
                </Box>

                {/* 菜单列表 */}
                <ScrollArea className="flex-1" scrollbars="vertical">
                    <Box p="3">
                        <Flex direction="column" gap="2">
                            {menuItems.map((item) => {
                                const isActive = activeMenu === item.key
                                return (
                                    <Link
                                        key={item.key}
                                        to={item.href}
                                        onClick={() => dispatch(setActiveMenu(item.key))}
                                        className={cn("menu-item", isActive && "active")}
                                    >
                                        <div className="icon">
                                            {item.icon}
                                        </div>
                                        {sidebarOpen && (
                                            <div className="text">
                                                <div className="title">{item.title}</div>
                                            </div>
                                        )}
                                        {isActive && sidebarOpen && <div className="indicator" />}
                                    </Link>
                                )
                            })}
                        </Flex>
                    </Box>
                </ScrollArea>

                {/* 侧边栏底部用户信息 */}
                <Flex p="3" className="border-t border-gray-200/50 dark:border-gray-700/50 flex-shrink-0">
                    <Flex
                        align="center"
                        gap="2"
                        p="2"
                        className={cn(
                            "rounded-xl bg-gray-50/50 dark:bg-gray-800/50 transition-all duration-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700",
                            !sidebarOpen && "justify-center"
                        )}
                    >
                        <Avatar.Root className="w-8 h-8 min-w-8 border-2 border-gray-200 dark:border-gray-700 flex-shrink-0">
                            <Avatar.Image src="https://i.pravatar.cc/150?u=admin" alt="管理员" />
                            <Avatar.Fallback>管</Avatar.Fallback>
                        </Avatar.Root>
                        {sidebarOpen && (
                            <Flex direction="column" gap="0" className="flex-1 min-w-0">
                                <Text size="2" weight="medium" className="truncate text-gray-900 dark:text-gray-100">
                                    管理员
                                </Text>
                                <Text size="1" color="gray" className="truncate">
                                    admin@zhin.com
                                </Text>
                            </Flex>
                        )}
                    </Flex>
                </Flex>
            </Flex>

            {/* 主内容区域 */}
            <Flex direction="column" className="flex-1 overflow-hidden">
                {/* 顶部导航栏 */}
                <Box className="glass border-b border-gray-200/50 dark:border-gray-700/50 shadow-sm">
                    <Flex justify="between" align="center" px="4" className="h-16">
                        {/* 左侧 */}
                        <Flex align="center" gap="3">
                            <IconButton
                                variant="ghost"
                                size="2"
                                onClick={() => dispatch(toggleSidebar())}
                                className="hover-lift rounded-xl"
                            >
                                <Menu className="w-5 h-5" />
                            </IconButton>
                            <Flex direction="column" gap="0">
                                <Heading size="3" className="text-gray-900 dark:text-gray-100">控制台</Heading>
                                <Text size="1" color="gray">欢迎回来！</Text>
                            </Flex>
                        </Flex>

                        {/* 中间搜索栏 */}
                        <Flex className="hidden md:flex flex-1 max-w-xl mx-6">
                            <Box className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                                <TextField.Root
                                    placeholder="搜索功能、用户、设置..."
                                    size="2"
                                    className="w-full pl-10"
                                />
                            </Box>
                        </Flex>

                        {/* 右侧操作区 */}
                        <Flex align="center" gap="2">
                            {/* 主题切换 */}
                            <ThemeToggle />

                            {/* 通知按钮 */}
                            <Box className="relative">
                                <IconButton
                                    variant="ghost"
                                    size="2"
                                    className="hover-lift rounded-xl"
                                >
                                    <Bell className="w-5 h-5" />
                                </IconButton>
                                <Badge
                                    color="red"
                                    variant="solid"
                                    size="1"
                                    className="absolute -top-1 -right-1 min-w-5 h-5 flex items-center justify-center p-0"
                                >
                                    3
                                </Badge>
                            </Box>

                            {/* 用户菜单 */}
                            <DropdownMenu.Root>
                                <DropdownMenu.Trigger asChild>
                                    <Flex
                                        align="center"
                                        gap="2"
                                        px="2"
                                        py="1"
                                        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 rounded-xl"
                                    >
                                        <Avatar.Root className="w-8 h-8 border-2 border-blue-500/20 dark:border-blue-400/30">
                                            <Avatar.Image src="https://i.pravatar.cc/150?u=admin" alt="管理员" />
                                            <Avatar.Fallback>管</Avatar.Fallback>
                                        </Avatar.Root>
                                        <Flex direction="column" gap="0" className="hidden lg:flex">
                                            <Text size="2" weight="medium" className="text-gray-900 dark:text-gray-100">
                                                管理员
                                            </Text>
                                            <Text size="1" color="gray">
                                                admin@zhin.com
                                            </Text>
                                        </Flex>
                                    </Flex>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content align="end" className="min-w-56">
                                    <Box p="3" className="border-b border-gray-200 dark:border-gray-700">
                                        <Text size="2" weight="bold" className="block">
                                            登录为
                                        </Text>
                                        <Text size="1" color="gray" className="block">
                                            admin@zhin.com
                                        </Text>
                                    </Box>
                                    <DropdownMenu.Item>
                                        <User className="mr-2 h-4 w-4" />
                                        我的设置
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item>
                                        <Users className="mr-2 h-4 w-4" />
                                        团队设置
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item>
                                        <BarChart3 className="mr-2 h-4 w-4" />
                                        数据分析
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item>
                                        <HelpCircle className="mr-2 h-4 w-4" />
                                        帮助与反馈
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Item color="red">
                                        <LogOut className="mr-2 h-4 w-4" />
                                        退出登录
                                    </DropdownMenu.Item>
                                </DropdownMenu.Content>
                            </DropdownMenu.Root>
                        </Flex>
                    </Flex>
                </Box>

                {/* 主内容区域 */}
                <Flex className="flex-1 overflow-auto">
                    <Container size="4" p="6">
                        <Outlet />
                    </Container>
                </Flex>
            </Flex>
        </Flex>
    )
}
