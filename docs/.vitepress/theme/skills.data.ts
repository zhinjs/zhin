import { defineLoader } from 'vitepress'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SkillInfo {
  id: string
  name: string
  description: string
  keywords?: string[]
  tags?: string[]
  author?: string
  source?: string
  homepage?: string
  lastUpdate?: string
}

export interface SkillStats {
  total: number
}

export interface SkillData {
  skills: SkillInfo[]
  stats: SkillStats
  updatedAt?: string | null
}

declare const data: SkillData
export { data }

export default defineLoader({
  watch: ['../../public/skills.json'],
  async load(): Promise<SkillData> {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const jsonPath = resolve(__dirname, '../../public/skills.json')
    try {
      const raw = readFileSync(jsonPath, 'utf-8')
      const json = JSON.parse(raw) as { skills: SkillInfo[]; updatedAt?: string | null }
      const skills = json.skills || []
      return {
        skills,
        stats: { total: skills.length },
        updatedAt: json.updatedAt ?? null,
      }
    } catch {
      return {
        skills: [],
        stats: { total: 0 },
        updatedAt: null,
      }
    }
  },
})
