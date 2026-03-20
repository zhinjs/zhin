/**
 * 从仓库内 SKILL.md 生成 docs/public/skills.json，供：
 * - 文档站点「技能商店」页面（SkillSearch）
 * - 线上 /skills.json 供 `zhin skills search` 等 CLI 拉取列表
 *
 * 分类：
 * - universal：create-zhin 模板 skills/，可复制到任意项目 skills/
 * - plugin：各插件包内 skills/，随 npm 安装，不可单独 zhin skills add
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const outFile = path.join(repoRoot, 'docs', 'public', 'skills.json')

function parseSkillMd(filePath) {
  const content = fs.readFileSync(filePath, 'utf8')
  const m = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  let meta
  try {
    meta = yaml.parse(m[1])
  } catch {
    return null
  }
  if (!meta?.name || meta.description == null) return null
  const description =
    typeof meta.description === 'string' ? meta.description : String(meta.description)
  return {
    name: meta.name,
    description,
    keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
    tags: Array.isArray(meta.tags) ? meta.tags : [],
  }
}

function scanUniversal() {
  const base = path.join(repoRoot, 'packages', 'create-zhin', 'template', 'skills')
  if (!fs.existsSync(base)) return []

  const skills = []
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const fp = path.join(base, ent.name, 'SKILL.md')
    if (!fs.existsSync(fp)) continue
    const meta = parseSkillMd(fp)
    if (!meta) continue

    const repoPath = path.relative(repoRoot, fp).split(path.sep).join('/')
    skills.push({
      id: `universal-${meta.name}`,
      name: meta.name,
      description: meta.description,
      keywords: meta.keywords,
      tags: [...new Set([...meta.tags, '通用技能'])],
      kind: 'universal',
      repoPath,
      installNote:
        '使用 create-zhin / `zhin new` 新建项目时，模板已含 `skills/`；也可从仓库复制该目录到你的项目 `skills/<name>/` 下，Agent 即可发现。',
    })
  }
  return skills
}

const PLUGIN_ROOTS = [
  'plugins/adapters',
  'plugins/services',
  'plugins/utils',
  'plugins/features',
  'plugins/games',
]

function scanPluginSkills() {
  const skills = []
  for (const rootRel of PLUGIN_ROOTS) {
    const root = path.join(repoRoot, rootRel)
    if (!fs.existsSync(root)) continue

    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const pkgPath = path.join(root, ent.name)
      const pjPath = path.join(pkgPath, 'package.json')
      if (!fs.existsSync(pjPath)) continue

      let pkgJson
      try {
        pkgJson = JSON.parse(fs.readFileSync(pjPath, 'utf8'))
      } catch {
        continue
      }
      const npmName = pkgJson.name
      if (!npmName) continue

      const skillsDir = path.join(pkgPath, 'skills')
      if (!fs.existsSync(skillsDir)) continue

      const category = path.basename(rootRel)

      for (const sEnt of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!sEnt.isDirectory()) continue
        const fp = path.join(skillsDir, sEnt.name, 'SKILL.md')
        if (!fs.existsSync(fp)) continue
        const meta = parseSkillMd(fp)
        if (!meta) continue

        const idSlug = `plugin-${category}-${ent.name}-${meta.name}`
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/-+/g, '-')
        const repoPath = path.relative(repoRoot, fp).split(path.sep).join('/')
        skills.push({
          id: idSlug,
          name: meta.name,
          description: meta.description,
          keywords: meta.keywords,
          tags: [...new Set([...meta.tags, '插件技能', npmName])],
          kind: 'plugin',
          pluginPackage: npmName,
          repoPath,
          installNote: `安装 npm 包 \`${npmName}\` 并在 \`zhin.config\` 中启用插件后，包内 \`skills/\` 会被 Agent 扫描（无需 \`zhin skills add\`）。`,
        })
      }
    }
  }
  return skills
}

function loadExtras() {
  const p = path.join(repoRoot, 'docs', 'public', 'skills-extras.json')
  if (!fs.existsSync(p)) return []
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(j.skills) ? j.skills : []
  } catch {
    return []
  }
}

function main() {
  const universal = scanUniversal()
  const plugin = scanPluginSkills()
  const extras = loadExtras()
  const seen = new Set()
  const merged = []
  for (const s of [...universal, ...plugin, ...extras]) {
    if (!s?.id) continue
    if (seen.has(s.id)) continue
    seen.add(s.id)
    merged.push(s)
  }
  const skills = merged.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'universal' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  const payload = {
    skills,
    updatedAt: new Date().toISOString().slice(0, 10),
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`[gen-skills] wrote ${skills.length} skills (${universal.length} universal, ${plugin.length} plugin) -> docs/public/skills.json`)
}

main()
