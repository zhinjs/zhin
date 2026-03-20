import {
  Outlet,
  Link,
  useSelector,
  useDispatch,
  toggleSidebar,
  setActiveMenu,
  type RouteMenuItem,
} from "@zhin.js/client"
import { useMemo, useState, useCallback, type KeyboardEvent } from "react"
import { useLocation, useNavigate, matchPath } from "react-router"
import { Menu, Search, LogOut } from 'lucide-react'
import { cn } from "@zhin.js/client"
import { ThemeToggle } from "../components/ThemeToggle"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { ScrollArea } from "../components/ui/scroll-area"
import { Separator } from "../components/ui/separator"
import { clearToken } from "../utils/auth"

const GROUP_ORDER = ["系统", "扩展", "配置与数据", "其他"] as const

function collectMenuRoutes(children: RouteMenuItem[]): RouteMenuItem[] {
  return children.filter((r) => !r.meta?.hideInMenu && r.key !== "dashboardLayout")
}

function useContentFullWidth(routes: RouteMenuItem[], pathname: string): boolean {
  return useMemo(() => {
    const dash = routes.find((r) => r.key === "dashboardLayout")
    const children = dash?.children ?? []
    for (const c of children) {
      if (!(c.meta as { fullWidth?: boolean } | undefined)?.fullWidth || !c.path) continue
      const m = matchPath({ path: c.path, end: true }, pathname)
      if (m) return true
    }
    return false
  }, [routes, pathname])
}

export default function DashboardLayout() {
  const dispatch = useDispatch()
  const location = useLocation()
  const navigate = useNavigate()
  const sidebarOpen = useSelector((state) => state.ui.sidebarOpen)
  const activeMenu = useSelector((state) => state.ui.activeMenu)
  const routes = useSelector((state) => state.route.routes)
  const [searchQ, setSearchQ] = useState("")

  const menuRoutes = useMemo(() => {
    const dashboardRoute = routes.find((route) => route.key === "dashboardLayout")
    if (!dashboardRoute?.children) return []
    return collectMenuRoutes(dashboardRoute.children).sort(
      (a, b) => (a.meta?.order ?? 999) - (b.meta?.order ?? 999),
    )
  }, [routes])

  const menuByGroup = useMemo(() => {
    const map = new Map<string, RouteMenuItem[]>()
    for (const r of menuRoutes) {
      const g = r.meta?.group ?? "其他"
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(r)
    }
    for (const [, items] of map) {
      items.sort((a, b) => (a.meta?.order ?? 999) - (b.meta?.order ?? 999))
    }
    return map
  }, [menuRoutes])

  const searchTargets = useMemo(
    () => menuRoutes.map((r) => ({ title: r.title, path: r.path, key: r.key })),
    [menuRoutes],
  )

  const searchHits = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    if (!q) return searchTargets
    return searchTargets.filter(
      (t) => t.title.toLowerCase().includes(q) || t.path.toLowerCase().includes(q),
    )
  }, [searchQ, searchTargets])

  const onSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return
      const first = searchHits[0]
      if (first?.path) {
        navigate(first.path)
        dispatch(setActiveMenu(first.key))
        setSearchQ("")
      }
    },
    [searchHits, navigate, dispatch],
  )

  const contentFullWidth = useContentFullWidth(routes, location.pathname)

  const orderedGroups = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const g of GROUP_ORDER) {
      if (menuByGroup.has(g) && menuByGroup.get(g)!.length) {
        out.push(g)
        seen.add(g)
      }
    }
    for (const g of menuByGroup.keys()) {
      if (!seen.has(g) && menuByGroup.get(g)!.length) out.push(g)
    }
    return out
  }, [menuByGroup])

  return (
    <div className="flex h-screen bg-background">
      <div
        className={cn(
          "flex flex-col border-r bg-sidebar transition-all duration-300",
          sidebarOpen ? "w-64" : "w-16",
        )}
      >
        <div className="p-4 border-b">
          <div
            className={cn(
              "flex items-center transition-all duration-300",
              sidebarOpen ? "gap-3" : "justify-center",
            )}
          >
            <div className="flex items-center justify-center w-9 h-9 min-w-9 rounded-lg bg-foreground text-background font-bold text-lg">
              Z
            </div>
            {sidebarOpen && (
              <div className="flex flex-col min-w-0">
                <span className="text-base font-semibold truncate">Zhin.js</span>
                <span className="text-xs text-muted-foreground">管理控制台</span>
              </div>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-3">
            {orderedGroups.map((groupName) => {
              const items = menuByGroup.get(groupName) ?? []
              if (!items.length) return null
              return (
                <div key={groupName} className="space-y-1">
                  {sidebarOpen && (
                    <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {groupName}
                    </div>
                  )}
                  {items.map((route, index) => {
                    const itemKey = route.key || `menu-item-${groupName}-${index}`
                    const isActive = activeMenu === itemKey
                    return (
                      <Link
                        key={itemKey}
                        to={route.path}
                        onClick={() => dispatch(setActiveMenu(itemKey))}
                        className={cn(
                          "menu-item",
                          isActive && "active",
                          !sidebarOpen && "justify-center px-2",
                        )}
                      >
                        <span className="shrink-0">{route.icon}</span>
                        {sidebarOpen && <span className="truncate">{route.title}</span>}
                      </Link>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <header className="flex items-center justify-between h-14 px-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => dispatch(toggleSidebar())}>
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex flex-col min-w-0">
              <h2 className="text-sm font-semibold truncate">控制台</h2>
              <span className="text-xs text-muted-foreground truncate">跳转菜单 · Enter 打开首条</span>
            </div>
          </div>

          <div className="hidden md:flex flex-1 max-w-md mx-4">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="按名称或路径搜索菜单…"
                className="pl-9 bg-muted/50"
                list="console-nav-search"
                autoComplete="off"
              />
              <datalist id="console-nav-search">
                {searchTargets.map((t) => (
                  <option key={t.path} value={`${t.title} ${t.path}`} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              title="退出登录"
              onClick={() => {
                clearToken()
                window.dispatchEvent(new CustomEvent("zhin:auth-required"))
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <Separator className="md:hidden" />

        <main className="flex-1 overflow-auto min-h-0">
          <div
            className={cn(
              "mx-auto p-6",
              contentFullWidth ? "max-w-none w-full" : "max-w-7xl",
            )}
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
