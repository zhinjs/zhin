import { useMemo, useState, useCallback, useSyncExternalStore, type ComponentType, type KeyboardEvent } from "react"
import { Outlet, Link, useLocation, useNavigate, matchPath } from "react-router-dom"
import * as LucideIcons from "lucide-react"
import { Menu, Search, LogOut } from "lucide-react"
import { app, cn, type ConsoleRouteRecord } from "@zhin.js/client"
import { ThemeToggle } from "../components/ThemeToggle"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { ScrollArea } from "../components/ui/scroll-area"
import { Separator } from "../components/ui/separator"
import { clearToken } from "../utils/auth"

const GROUP_ORDER = ["系统", "扩展", "配置与数据", "其他"] as const

function SidebarMenuIcon({ icon }: { icon?: React.ReactNode | string }) {
  if (icon == null) return null
  if (typeof icon === "string") {
    const Cmp = (LucideIcons as Record<string, ComponentType<{ className?: string }>>)[icon]
    if (!Cmp || typeof Cmp !== "function") return null
    return <Cmp className="w-4 h-4" />
  }
  return <>{icon}</>
}

function collectMenuRoutes(routes: readonly ConsoleRouteRecord[]): ConsoleRouteRecord[] {
  return routes.filter((r) => !r.meta?.hideInMenu)
}

function useContentFullWidth(routes: readonly ConsoleRouteRecord[], pathname: string): boolean {
  return useMemo(() => {
    for (const r of routes) {
      if (!r.meta?.fullWidth || !r.path) continue
      if (matchPath({ path: r.path, end: true }, pathname)) return true
    }
    return false
  }, [routes, pathname])
}

export default function DashboardLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [searchQ, setSearchQ] = useState("")

  const routes = useSyncExternalStore(
    app.subscribe,
    () => app._getRoutes(),
  )

  const menuRoutes = useMemo(() => {
    return collectMenuRoutes(routes).sort(
      (a, b) => (a.meta?.order ?? 999) - (b.meta?.order ?? 999),
    )
  }, [routes])

  const menuByGroup = useMemo(() => {
    const map = new Map<string, ConsoleRouteRecord[]>()
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
    () => menuRoutes.map((r) => ({ title: r.name, path: r.path })),
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
        setActiveMenu(first.path)
        setSearchQ("")
      }
    },
    [searchHits, navigate],
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
                    const itemKey = route.path || `menu-item-${groupName}-${index}`
                    const isActive = activeMenu === itemKey || location.pathname === route.path || location.pathname.startsWith(route.path + "/")
                    return (
                      <Link
                        key={itemKey}
                        to={route.path}
                        onClick={() => setActiveMenu(itemKey)}
                        className={cn(
                          "menu-item",
                          isActive && "active",
                          !sidebarOpen && "justify-center px-2",
                        )}
                      >
                        <span className="shrink-0">
                          <SidebarMenuIcon icon={route.icon} />
                        </span>
                        {sidebarOpen && <span className="truncate">{route.name}</span>}
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
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen((v) => !v)}>
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
