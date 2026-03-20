import { defineLoader } from 'vitepress'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** universal = 模板/可复制到项目 skills/；plugin = 随 npm 插件包分发 */
export type SkillKind = 'universal' | 'plugin'

export interface SkillInfo {
  id: string
  name: string
  description: string
  keywords?: string[]
  tags?: string[]
  /** 通用技能 | 插件自带技能 */
  kind?: SkillKind
  /** kind=plugin 时的 npm 包名 */
  pluginPackage?: string
  /** 仓库内相对路径（如 plugins/utils/checkin/skills/checkin/SKILL.md） */
  repoPath?: string
  /** 安装/获得方式的说明（替代「zhin skills add」） */
  installNote?: string
  author?: string
  /** 可下载 ZIP（社区技能）；与 kind 无关 */
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
  watch: ['../../public/skills.json', '../../public/skills-extras.json', '../../../scripts/build-skills-registry.mjs'],
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
