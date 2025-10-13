import { useMemo } from 'react'
import { createBrowserRouter, RouterProvider as ReactRouterProvider, RouteObject, Outlet} from 'react-router'
import { store, addRoute, removeRoute, updateRoute, clearRoutes, RouteMenuItem, useSelector } from '../store'
export { useOutlet, Outlet, Link, useNavigate, useParams } from 'react-router'




export const addPage = (route: RouteMenuItem) => store.dispatch(addRoute(route))
export const removePage = (path: string) => store.dispatch(removeRoute(path))
export const updatePage = (path: string, route: RouteMenuItem) => store.dispatch(updateRoute({
  path,
  updates: route
}))
export const getPage = (path: string) => store.getState().route.routes.find(route => route.path === path)
export const getAllPages = () => store.getState().route.routes
export const clearPages = () => store.dispatch(clearRoutes())

// 动态路由组件（从 Redux store 读取）
export function DynamicRouter() {
  const storeRoutes = useSelector((state) => state.route.routes)
  console.log(storeRoutes)
  const router = useMemo(() => {
    // 递归转换路由（支持多层嵌套）
    const convertRoute = (route: RouteMenuItem): RouteObject => {
      const routeObj: RouteObject = {
        path: route.path,
        element: route.element,
        Component: route.Component,
      }
      
      // 递归处理子路由
      if (route.children && route.children.length > 0) {
        routeObj.children = route.children.map((child: RouteMenuItem) => convertRoute(child))
      }
      return routeObj
    }
    const routeObjects: RouteObject[] = storeRoutes.map(convertRoute)
    const defaultRoutes: RouteObject[] = [
      {
        path: '/',
        element: <Outlet />,
        children: routeObjects,
      },
      {
        path: '*',
        element: <div>404 - Page Not Found</div>,
      }
    ]
    
    return createBrowserRouter(defaultRoutes)
  }, [storeRoutes])

  return <ReactRouterProvider router={router} />
}
