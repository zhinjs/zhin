import * as React from 'react'
import { app } from '@zhin.js/client'
import type {
  ConsoleClientEntry,
  ConsolePluginRegister,
  ConsoleEntriesResponse,
  PluginRegisterHostApi,
} from '@zhin.js/console-types'
import { DEFAULT_CONSOLE_BASE_PATH } from '@zhin.js/console-types'
import { getToken } from './utils/auth'

const addRoute = app.addRoute.bind(app)
const defaultHostApi: PluginRegisterHostApi = {
  React,
  addRoute,
  addPage: addRoute,
  addTool: app.addTool.bind(app),
}

function getRegisterFn(mod: Record<string, unknown> | null | undefined): ConsolePluginRegister | null {
  if (!mod) return null
  const r = mod['register']
  if (typeof r === 'function') return r as ConsolePluginRegister
  const d = mod['default'] as Record<string, unknown> | undefined
  if (d && typeof d['register'] === 'function') return d['register'] as ConsolePluginRegister
  return null
}

let inflight: Promise<void> | null = null

export function loadConsoleEntries(): Promise<void> {
  if (inflight) return inflight
  inflight = doLoad().finally(() => { inflight = null })
  return inflight
}

async function doLoad() {
  const token = getToken()
  const url = `${window.location.origin}${DEFAULT_CONSOLE_BASE_PATH}/entries`
  const res = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    console.warn(`[console] entries fetch failed: ${res.status}`)
    return
  }
  const data = (await res.json()) as ConsoleEntriesResponse
  if (!data.entries?.length) return

  await Promise.all(
    data.entries.map(async (e: ConsoleClientEntry) => {
      try {
        const specifier = new URL(e.resolvedModule, window.location.origin).href
        const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>
        const register = getRegisterFn(mod)
        if (register) await register(defaultHostApi)
      } catch (err) {
        console.error(`[console] Failed to load plugin "${e.id}":`, err)
      }
    }),
  )
}
