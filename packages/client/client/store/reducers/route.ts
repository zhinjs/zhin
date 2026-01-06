import { createSlice, PayloadAction } from "@reduxjs/toolkit"
import { ComponentType, ReactNode } from "react"

// 路由菜单项接口
export interface RouteMenuItem {
    key: string
    path: string
    title: string
    index?: boolean
    icon?: ReactNode
    element?: ReactNode
    Component?: ComponentType
    children?: RouteMenuItem[]
    meta?: {
        hideInMenu?: boolean
        requiresAuth?: boolean
        order?: number
    }
}

export interface RouteState {
    routes: RouteMenuItem[]
}

const initialState: RouteState = {
    routes: []
}

// 辅助函数：查找最佳父路由
const findBestParent = (routes: RouteMenuItem[], fullPath: string): RouteMenuItem | null => {
    const segments = fullPath.split('/').filter(Boolean)
    
    for (let i = segments.length - 1; i > 0; i--) {
        const parentPath = '/' + segments.slice(0, i).join('/')
        const parent = routes.find(r => r.path === parentPath)
        if (parent) return parent
    }
    
    return routes.find(r=>r.path==='/')||null
}

// 辅助函数：计算相对路径
const calculateRelativePath = (parentPath: string, fullPath: string): string => {
    if (parentPath === '/') return fullPath
    return fullPath.replace(parentPath + '/', '')
}

const routeSlice = createSlice({
    name: 'route',
    initialState,
    reducers: {
        addRoute: (state, action: PayloadAction<RouteMenuItem>) => {
            const route = action.payload
            const parent = findBestParent(state.routes, route.path)
            
            if (parent) {
                if (!parent.children) parent.children = []
                const relativePath = calculateRelativePath(parent.path, route.path)
                parent.children.push({ ...route, path: relativePath })
            } else {
                state.routes.push(route)
            }
            
            state.routes.sort((a, b) => (a.meta?.order || 999) - (b.meta?.order || 999))
        },
        
        removeRoute: (state, action: PayloadAction<string>) => {
            const path = action.payload
            
            const removeFromArray = (routes: RouteMenuItem[]): boolean => {
                const index = routes.findIndex(r => r.path === path)
                if (index >= 0) {
                    routes.splice(index, 1)
                    return true
                }
                
                for (const route of routes) {
                    if (route.children && removeFromArray(route.children)) {
                        return true
                    }
                }
                return false
            }
            
            removeFromArray(state.routes)
        },
        
        updateRoute: (state, action: PayloadAction<{ path: string; updates: Partial<RouteMenuItem> }>) => {
            const { path, updates } = action.payload
            
            const updateInArray = (routes: RouteMenuItem[]): boolean => {
                const index = routes.findIndex(r => r.path === path)
                if (index >= 0) {
                    routes[index] = { ...routes[index], ...updates }
                    return true
                }
                
                for (const route of routes) {
                    if (route.children && updateInArray(route.children)) {
                        return true
                    }
                }
                return false
            }
            
            updateInArray(state.routes)
        },
        
        setRoutes: (state, action: PayloadAction<RouteMenuItem[]>) => {
            state.routes = action.payload
            state.routes.sort((a, b) => (a.meta?.order || 999) - (b.meta?.order || 999))
        },
        
        clearRoutes: (state) => {
            state.routes = []
        }
    }
})

export const { addRoute, removeRoute, updateRoute, setRoutes, clearRoutes } = routeSlice.actions
export default routeSlice.reducer

