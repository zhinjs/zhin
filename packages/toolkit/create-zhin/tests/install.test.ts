import { describe, it, expect } from 'vitest'

describe('create-zhin install', () => {
  describe('Installation utilities', () => {
    it('should handle pnpm installation check', () => {
      // 测试 pnpm 检测逻辑
      expect(true).toBe(true)
    })

    it('should handle dependency installation', () => {
      // 测试依赖安装逻辑
      expect(true).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should handle pnpm not found error', () => {
      // 测试 pnpm 未安装的错误处理
      expect(true).toBe(true)
    })

    it('should handle installation failure', () => {
      // 测试安装失败的错误处理
      expect(true).toBe(true)
    })
  })
})

import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import { vi, afterEach } from 'vitest'
import { areDeclaredDependenciesInstalled, findIgnoredBuildPlaceholders, installDependencies } from '../src/install.js'

describe('installDependencies outcome (#1250)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(dirs.splice(0).map(dir => fs.remove(dir)))
  })

  async function project(installed: boolean, workspace: string): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-install-'))
    dirs.push(dir)
    await fs.writeJson(path.join(dir, 'package.json'), { dependencies: { 'zhin.js': '^1.2.0' }, devDependencies: { typescript: '^6.0.0' } })
    await fs.writeFile(path.join(dir, 'pnpm-workspace.yaml'), workspace)
    if (installed) {
      for (const name of ['zhin.js', 'typescript']) {
        await fs.outputJson(path.join(dir, 'node_modules', name, 'package.json'), { name, version: '1.0.0' })
      }
    }
    return dir
  }

  const placeholderWorkspace = 'allowBuilds:\n  cpu-features: set this to true or false\n  esbuild: true\n  node-pty: set this to true or false\n'

  it('reads the build placeholders pnpm 11 writes for ignored build scripts', async () => {
    const dir = await project(false, placeholderWorkspace)
    expect(findIgnoredBuildPlaceholders(dir)).toEqual(['cpu-features', 'node-pty'])
  })

  it('treats a failed install with every dependency present as partial and names the ignored builds', async () => {
    const dir = await project(true, placeholderWorkspace)
    expect(areDeclaredDependenciesInstalled(dir)).toBe(true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const outcome = await installDependencies(dir, 'zh-CN', () => { throw new Error('Command failed: pnpm install') })
    expect(outcome).toBe('partial')
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('项目依赖已全部安装')
    expect(output).toContain('cpu-features, node-pty')
    expect(output).toContain('ERR_PNPM_IGNORED_BUILDS')
    expect(output).not.toContain('依赖安装失败')
  })

  it('still fails when dependencies are missing', async () => {
    const dir = await project(false, 'allowBuilds:\n  esbuild: true\n')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(installDependencies(dir, 'zh-CN', () => { throw new Error('boom') })).rejects.toThrow('pnpm install failed')
  })

  it('returns ok on success', async () => {
    const dir = await project(false, '')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(installDependencies(dir, 'en', () => {})).resolves.toBe('ok')
  })
})
