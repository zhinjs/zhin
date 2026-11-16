import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { cn } from '../cn.js'
import { RefreshControl, type RefreshControlProps } from './RefreshControl.js'
import { PageActions, type PageAction } from './actions.js'

/**
 * Page chrome a page hands to the shell (ADR 0063 决策 2): the shell places the header actions and
 * the refresh control; the page itself renders only its content.
 */
export interface PageChrome {
  /** Header actions (buttons, menus). */
  readonly actions?: ReactNode
  /** Shows a RefreshControl in the header. */
  readonly refresh?: RefreshControlProps
  /** Labelled actions: buttons on wide headers, folded into 「更多」 below 40rem (D18 第 7 条). */
  readonly menuActions?: readonly PageAction[]
  /** Actions that always live in the 「更多」 menu. */
  readonly moreActions?: readonly PageAction[]
}

export interface PageChromeStore {
  get(): PageChrome | undefined
  /** Replaces the chrome; returns a release function that clears it only if it is still the latest. */
  set(chrome: PageChrome): () => void
  subscribe(listener: () => void): () => void
}

/** One store per mounted page slot; the shell creates it and passes it to {@link PageChromeProvider}. */
export function createPageChromeStore(): PageChromeStore {
  let current: { readonly token: object; readonly chrome: PageChrome } | undefined
  const listeners = new Set<() => void>()
  const emit = () => { for (const listener of [...listeners]) listener() }
  return {
    get: () => current?.chrome,
    set(chrome) {
      const token = {}
      current = { token, chrome }
      emit()
      return () => {
        if (current?.token !== token) return
        current = undefined
        emit()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const PageChromeContext = createContext<PageChromeStore | null>(null)

export interface PageChromeProviderProps {
  /** Store owned by the shell; omit to let the provider create one. */
  readonly store?: PageChromeStore
  readonly children?: ReactNode
}

/** Wraps a page slot so pages inside can call {@link usePageChrome}. */
export function PageChromeProvider({ store, children }: PageChromeProviderProps) {
  const value = useMemo(() => store ?? createPageChromeStore(), [store])
  return <PageChromeContext.Provider value={value}>{children}</PageChromeContext.Provider>
}

/**
 * Hands header actions and the refresh control to the shell. Returns `true` when a shell is
 * listening; `false` means the page renders outside a shell (e.g. an older Console) and may draw
 * the controls itself.
 */
export function usePageChrome(chrome: PageChrome): boolean {
  const store = useContext(PageChromeContext)
  const { actions, refresh, menuActions, moreActions } = chrome
  useEffect(() => {
    if (!store) return
    return store.set({ actions, refresh, menuActions, moreActions })
  }, [store, actions, refresh, menuActions, moreActions])
  return store !== null
}

/** The chrome the current page registered; for the shell. */
export function usePageChromeState(store?: PageChromeStore): PageChrome | undefined {
  const contextStore = useContext(PageChromeContext)
  const target = store ?? contextStore
  return useSyncExternalStore(
    target?.subscribe ?? noopSubscribe,
    target?.get ?? noopGet,
    target?.get ?? noopGet,
  )
}

const noopSubscribe = () => () => {}
const noopGet = () => undefined

export interface PageChromeActionsProps {
  readonly store?: PageChromeStore
  readonly className?: string
}

/** Renders the registered refresh control and actions; the shell puts it into `PageHeader.actions`. */
export function PageChromeActions({ store, className }: PageChromeActionsProps) {
  const chrome = usePageChromeState(store)
  if (!chrome || (chrome.actions == null && !chrome.refresh && !chrome.menuActions?.length && !chrome.moreActions?.length)) return null
  return (
    <PageActions className={cn('console-page-chrome-actions', className)} actions={chrome.menuActions} moreActions={chrome.moreActions}>
      {chrome.refresh ? <RefreshControl {...chrome.refresh} /> : null}
      {chrome.actions}
    </PageActions>
  )
}
