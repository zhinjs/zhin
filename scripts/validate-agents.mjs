#!/usr/bin/env node

/**
 * Agent Files Validator
 * 
 * This script validates the GitHub Copilot agent files to ensure:
 * 1. All agent files exist
 * 2. Files are not empty
 * 3. Files contain required sections
 * 4. Markdown syntax is valid
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentsDir = join(__dirname, '..', '.github', 'agents')

const AGENT_FILES = [
  'zhin.agent.md',
  'plugin-developer.agent.md',
  'adapter-developer.agent.md',
  'README.md'
]

const REQUIRED_SECTIONS = {
  'zhin.agent.md': [
    '# Zhin Framework Development Agent',
    '## 🎯 核心原则',
    '## ⚠️ 严格规则'
  ],
  'plugin-developer.agent.md': [
    '# Zhin.js Plugin Development Agent',
    '## 🎯 专业领域',
    '## 📋 插件开发标准流程',
    '## 🔧 核心模板'
  ],
  'adapter-developer.agent.md': [
    '# Zhin.js Adapter Development Agent',
    '## 🎯 专业领域',
    '## 📋 适配器开发核心概念',
    '## 🔧 完整适配器模板'
  ],
  'README.md': [
    '# Zhin.js GitHub Copilot Agents',
    '## 📁 Agent 列表',
    '## 🚀 使用方法'
  ]
}

let errors = 0
let warnings = 0

console.log('🔍 验证 GitHub Copilot Agent 文件...\n')

// Check if all required files exist
for (const file of AGENT_FILES) {
  const filePath = join(agentsDir, file)
  
  process.stdout.write(`📄 检查 ${file}... `)
  
  if (!existsSync(filePath)) {
    console.log('❌ 文件不存在')
    errors++
    continue
  }
  
  const content = readFileSync(filePath, 'utf-8')
  
  // Check if file is empty
  if (content.trim().length === 0) {
    console.log('❌ 文件为空')
    errors++
    continue
  }
  
  // Check if file has minimum length (at least 1000 characters for agent files)
  if (file.endsWith('.agent.md') && content.length < 1000) {
    console.log('⚠️  文件内容过短')
    warnings++
  }
  
  // Check required sections
  const requiredSections = REQUIRED_SECTIONS[file] || []
  const missingSections = []
  
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      missingSections.push(section)
    }
  }
  
  if (missingSections.length > 0) {
    console.log('❌ 缺少必需章节:')
    missingSections.forEach(section => console.log(`   - ${section}`))
    errors++
    continue
  }
  
  // Check for common markdown issues
  const lines = content.split('\n')
  let hasCodeBlocks = false
  let inCodeBlock = false
  
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      hasCodeBlocks = true
      inCodeBlock = !inCodeBlock
    }
  }
  
  if (inCodeBlock) {
    console.log('⚠️  存在未闭合的代码块')
    warnings++
  }
  
  // Agent files should have code examples
  if (file.endsWith('.agent.md') && !hasCodeBlocks) {
    console.log('⚠️  缺少代码示例')
    warnings++
  }
  
  console.log('✅ 验证通过')
}

console.log('\n' + '='.repeat(50))
console.log(`📊 验证结果: ${AGENT_FILES.length} 个文件`)
console.log(`✅ 通过: ${AGENT_FILES.length - errors}`)
console.log(`❌ 错误: ${errors}`)
console.log(`⚠️  警告: ${warnings}`)
console.log('='.repeat(50))

if (errors > 0) {
  console.log('\n❌ 验证失败！请修复上述错误。')
  process.exit(1)
} else if (warnings > 0) {
  console.log('\n⚠️  验证通过，但存在警告。')
  process.exit(0)
} else {
  console.log('\n✅ 所有 Agent 文件验证通过！')
  process.exit(0)
}
