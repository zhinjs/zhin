import {configureStore, Reducer, Action,combineReducers} from '@reduxjs/toolkit'
import {
    FLUSH,
    PAUSE,
    PERSIST,
    persistReducer,
    persistStore,
    PURGE,
    REGISTER,
    REHYDRATE,
    createTransform,
  } from 'redux-persist';
import createWebStorage from 'redux-persist/lib/storage/createWebStorage';
import {reducers, Reducers } from './reducers';
import { useDispatch as useReduxDispatch, TypedUseSelectorHook, useSelector as useReduxSelector } from 'react-redux';

// 创建 transform 过滤不可序列化的字段
const routeTransform = createTransform(
    (inboundState: any) => {
        const { routes, ...rest } = inboundState
        return rest
    },
    (outboundState: any) => {
        return { ...outboundState, routes: [] }
    },
    { whitelist: ['route'] }
)

const scriptTransform = createTransform(
    (inboundState: any) => {
        const { entries, loadedScripts, ...rest } = inboundState
        return rest
    },
    (outboundState: any) => {
        return { ...outboundState, entries: [], loadedScripts: [] }
    },
    { whitelist: ['script'] }
)

const persistConfig: any = {
    key: 'root',
    storage: createWebStorage('local'),
    transforms: [routeTransform, scriptTransform],
}
const persistedReducer = persistReducer(persistConfig, combineReducers(reducers)) as any
export const store = configureStore<Reducers>({
    reducer:persistedReducer as Reducer,
    middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          FLUSH, 
          REHYDRATE, 
          PAUSE, 
          PERSIST, 
          PURGE, 
          REGISTER,
          // 忽略包含 React 组件的路由 actions
          'route/addRoute',
          'route/updateRoute',
          'route/setRoutes',
        ],
        // 忽略 state 中的 routes 字段
        ignoredPaths: ['route.routes'],
      },
    }),
})
export const persistor = persistStore(store);

// 将 store 挂载到 window 以供 DynamicRouter 使用
if (typeof window !== 'undefined') {
    // @ts-ignore
    window.__REDUX_STORE__ = store
}
export function addReducer<T,A extends Action>(name:keyof Reducers,reducer:Reducer<T,A>) {
    reducers[name] = reducer
    const newPersistedReducer = persistReducer(persistConfig, combineReducers(reducers)) as any
    store.replaceReducer(newPersistedReducer as Reducer)
}
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export const useDispatch:()=>AppDispatch = useReduxDispatch
export const useSelector:TypedUseSelectorHook<RootState> = useReduxSelector

// 导出 UI actions
export { 
    toggleSidebar, 
    setSidebarOpen, 
    setActiveMenu
} from './reducers/ui'

// 导出 Route actions
export { 
    addRoute,
    removeRoute,
    updateRoute,
    setRoutes,
    clearRoutes
} from './reducers/route'

// 导出 Script actions 和 thunks
export { 
    syncEntries,
    addEntry,
    removeEntry,
    loadScript,
    loadScripts,
    unloadScript
} from './reducers/script'

export type { RouteMenuItem } from './reducers/route'