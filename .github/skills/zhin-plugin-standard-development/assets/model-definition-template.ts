// @ts-nocheck
import type { Definition } from '@zhin.js/core'

export interface ProfileRow {
  id?: number
  user_id: string
  nickname: string
  points: number
  metadata?: unknown
}

export const PROFILE_MODEL = 'plugin_profiles'

export const ProfileDefinition: Definition<ProfileRow> = {
  id: { type: 'integer', primary: true, autoIncrement: true },
  user_id: { type: 'text', nullable: false },
  nickname: { type: 'text', nullable: false },
  points: { type: 'integer', nullable: false, default: 0 },
  metadata: { type: 'json' },
}

export function registerPluginModels(root: {
  defineModel?: (name: string, definition: Definition<unknown>) => void
}) {
  if (typeof root.defineModel !== 'function') {
    return
  }
  root.defineModel(PROFILE_MODEL, ProfileDefinition as Definition<unknown>)
}