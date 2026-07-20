/**
 * install_skill — 从 URL 下载 SKILL.md 并安装到本地 skills/ 目录
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { type Tool, type Message, type ToolParametersSchema, type ToolResult, getLogger } from '@zhin.js/core';
import { errMsg } from '../discovery/utils.js';
import { BuiltinBaseTool } from './builtin-base-tool.js';

export interface InstallSkillToolOptions {
  /**
   * 安装根目录：将创建 `<skillName>/SKILL.md`。
   * 默认 `join(process.cwd(), 'skills')`（与历史行为一致）。
   */
  skillsInstallRoot?: string;
  /** 可注入以便单测 mock */
  fetchImpl?: typeof fetch;
}

export const INSTALL_SKILL_PARAMETERS: ToolParametersSchema = {
  type: 'object',
  properties: {
    url: {
      type: 'string',
      description: 'Full URL of a SKILL.md file (e.g. https://example.com/skill.md)',
    },
  },
  required: ['url'],
};

const logger = getLogger('install-skill-tool');

export class InstallSkillBuiltinTool extends BuiltinBaseTool {
  readonly name = 'install_skill';
  readonly description =
    'Download SKILL.md from a URL and install it under local skills/. Use when the user asks to add, install, or download a skill.';
  readonly parameters = INSTALL_SKILL_PARAMETERS;
  readonly kind = 'skill';

  constructor(private readonly opts: InstallSkillToolOptions = {}) {
    super();
    this.tags.push('skill', 'install');
    this.keywords.push(
      '安装技能',
      '下载技能',
      '加入',
      '添加技能',
      'install',
      'skill',
      'join',
      '学会',
      '学习技能',
    );
  }

  private skillsRoot(): string {
    return this.opts.skillsInstallRoot ?? path.join(process.cwd(), 'skills');
  }

  async run(args: Record<string, unknown>, _commMessage?: Message): Promise<ToolResult> {
    const fetchFn = this.opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    try {
      const response = await fetchFn(args.url as string, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ZhinBot/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return `Error: HTTP ${response.status} ${response.statusText}`;
      const content = await response.text();

      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) return 'Error: 无效的 SKILL.md 文件（缺少 frontmatter）';

      let jsYaml: any;
      try {
        jsYaml = await import('js-yaml');
        if (jsYaml.default) jsYaml = jsYaml.default;
      } catch {
        return 'Error: 无法加载 yaml 解析器';
      }

      const metadata = jsYaml.load(fmMatch[1]);
      if (!metadata?.name) return 'Error: SKILL.md 缺少 name 字段';

      const skillName: string = metadata.name;
      const skillDir = path.join(this.skillsRoot(), skillName);
      await fs.mkdir(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');
      await fs.writeFile(skillPath, content, 'utf-8');

      logger.info(`技能已安装: ${skillName} → ${skillPath}`);
      return `✅ 技能「${skillName}」已安装到 ${skillPath}。现在可以用 load_skill("${skillName}") 加载它。`;
    } catch (e: unknown) {
      return `Error: ${errMsg(e)}`;
    }
  }
}

export function createInstallSkillTool(opts?: InstallSkillToolOptions): Tool {
  return new InstallSkillBuiltinTool(opts).toTool();
}
