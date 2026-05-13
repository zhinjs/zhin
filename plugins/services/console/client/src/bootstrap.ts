import * as React from 'react'
import { app } from '@zhin.js/client'
import {
  createPluginRegisterHostApi,
  loadConsoleEntries as loadEntriesFromCore,
} from '@zhin.js/console-core/browser'
import { DEFAULT_CONSOLE_BASE_PATH } from '@zhin.js/console-types'
import { getToken } from './utils/auth'

const addRoute = app.addRoute.bind(app)
const defaultHostApi = createPluginRegisterHostApi({
  React,
  addRoute,
  addTool: app.addTool.bind(app),
})

let inflight: Promise<void> | null = null

export function loadConsoleEntries(): Promise<void> {
  if (inflight) return inflight
  inflight = doLoad().finally(() => { inflight = null })
  return inflight
}

async function doLoad() {
  await loadEntriesFromCore({
    entriesUrl: `${window.location.origin}${DEFAULT_CONSOLE_BASE_PATH}/entries`,
    hostApi: defaultHostApi,
    fetchInit: () => {
      const token = getToken()
      return {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    },
    onFetchError: status => console.warn(`[console] entries fetch failed: ${status}`),
    onEntryError: (entry, error) => console.error(`[console] Failed to load plugin "${entry.id}":`, error),
  })
}
