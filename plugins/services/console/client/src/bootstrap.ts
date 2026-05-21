import * as React from 'react'
import { app } from '@zhin.js/client'
import {
  createPluginRegisterHostApi,
  loadConsoleEntries as loadEntriesFromCore,
} from '@zhin.js/console-core/browser'
import { getApiBase, getToken } from './utils/auth'

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
  const apiBase = getApiBase()
  await loadEntriesFromCore({
    entriesUrl: `${apiBase}/entries`,
    assetOrigin: apiBase,
    hostApi: defaultHostApi,
    fetchInit: () => {
      const token = getToken()
      return {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }
    },
    onFetchError: status => console.warn(`[console] entries fetch failed: ${status}`),
    onEntryError: (entry, error) => console.error(`[console] Failed to load plugin "${entry.id}":`, error),
  })
}
