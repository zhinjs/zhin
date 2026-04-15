// 直接导出 React（不通过静态属性快照，而是动态属性访问器）
// 这确保了 react-dom-client 设置的 __CLIENT_INTERNALS 与 hooks 使用的是同一个对象
import React from 'react';

// 导出默认对象
const R = React.default || React;
export default R;

// 所有导出都通过属性访问器，而不是静态快照
// 这样可以确保共享 CJS 模块的内部状态
export const {
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  cache,
  cacheSignal,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  unstable_useCacheRefresh,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = R;
