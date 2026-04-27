import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { CONSOLE_HOST_REACT_NAMESPACE_KEY } from '@zhin.js/console-types'
import { app, useWebSocket } from '@zhin.js/client'
import { loadConsoleEntries } from './bootstrap'
import { registerBuiltinConsolePages } from './registerBuiltinShell'
import LoginPage from './pages/login'
import DashboardLayout from './layouts/dashboard'
import { hasToken } from './utils/auth'
import './style.css'
import { initializeTheme } from './theme'
import { TooltipProvider } from './components/ui/tooltip'

initializeTheme()

const consoleHostReactNamespace = Object.assign(
  Object.create(null),
  React,
  ReactJsxRuntime,
  ReactJsxDevRuntime,
);
(globalThis as Record<string, unknown>)[CONSOLE_HOST_REACT_NAMESPACE_KEY] = consoleHostReactNamespace

function useConsoleRouteElements(): React.ReactElement {
  const v = React.useSyncExternalStore(app.subscribe, app.getVersion, app.getVersion)
  void v
  const routeRecords = app._getRoutes()

  return (
    <>
      {routeRecords.map((r) => (
        <Route key={r.path} path={r.path} element={app._renderRouteElement(r)} />
      ))}
    </>
  )
}

function ConsoleShell() {
  const [ready, setReady] = React.useState(false)
  const registeredRoutes = useConsoleRouteElements()

  useWebSocket()

  React.useEffect(() => {
    registerBuiltinConsolePages()
    loadConsoleEntries()
      .then(() => React.startTransition(() => setReady(true)))
      .catch(() => setReady(true))
  }, [])

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-muted-foreground border-t-foreground"></div>
          <p className="mt-3 text-sm text-muted-foreground">加载中…</p>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      {registeredRoutes}
      <Route path="/" element={<Navigate to="/console/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/console/dashboard" replace />} />
    </Routes>
  )
}

function App() {
  const [authed, setAuthed] = React.useState(hasToken())
  const handleLogin = React.useCallback(() => setAuthed(true), [])

  React.useEffect(() => {
    const onAuthRequired = () => setAuthed(false)
    window.addEventListener('zhin:auth-required', onAuthRequired)
    return () => window.removeEventListener('zhin:auth-required', onAuthRequired)
  }, [])

  if (!authed) {
    return <LoginPage onSuccess={handleLogin} />
  }

  return <ConsoleShell />
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </BrowserRouter>
    </TooltipProvider>
  </React.StrictMode>,
)
