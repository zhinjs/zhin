import { apiFetch as coreApiFetch, getApiBase as coreGetApiBase } from '@zhin.js/console-core'

const TOKEN_KEY = 'zhin_api_token'
const API_BASE_KEY = 'zhin_api_base'

export const getApiBase = coreGetApiBase

export function setApiBase(base: string): void {
  localStorage.setItem(API_BASE_KEY, base.replace(/\/$/, ''))
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function clearApiBase(): void {
  localStorage.removeItem(API_BASE_KEY)
}

export function hasToken(): boolean {
  return !!localStorage.getItem(TOKEN_KEY)
}

export const apiFetch = coreApiFetch
