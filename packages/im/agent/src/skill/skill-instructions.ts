import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Return a readable warning when a Skill declares unavailable executable dependencies. */
export async function checkSkillDependencies(content: string): Promise<string> {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/u);
  if (!frontmatter) return '';
  const module = await import('js-yaml');
  const yaml = module.default ?? module;
  const metadata = yaml.load(frontmatter[1]!) as {
    readonly compatibility?: { readonly deps?: unknown };
  } | null;
  const dependencies = metadata?.compatibility?.deps;
  if (!Array.isArray(dependencies)) return '';
  const missing: string[] = [];
  for (const value of dependencies) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      await execFileAsync('which', [value]);
    } catch {
      missing.push(value);
    }
  }
  return missing.length === 0
    ? ''
    : `⚠️ 当前环境缺少以下依赖，请先安装后再使用本技能：${missing.join(', ')}`;
}

/** Extract bounded, action-oriented instructions from a SKILL.md document. */
export function extractSkillInstructions(
  name: string,
  content: string,
  maxBodyLength = 4000,
): string {
  const lines = [`Skill '${name}' loaded. 请立即根据以下指导执行工具调用：`, ''];
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/u);
  if (frontmatter) {
    const tools = frontmatter[1]!.match(/tools:\s*\n((?:\s+-\s+.+\n?)+)/u);
    if (tools) lines.push('## 可用工具', tools[0].trim(), '');
  }
  const body = frontmatter && frontmatter.index !== undefined
    ? content.slice(frontmatter.index + frontmatter[0].length).replace(/^\s+/u, '')
    : content;
  const quickActions = body.match(/## (?:快速操作|Quick\s*Actions)[\s\S]*?(?=\n## [^\s]|$)/iu);
  if (quickActions && maxBodyLength <= 2000) {
    lines.push(quickActions[0].trim(), '', immediateAction());
    return lines.join('\n');
  }
  const rules = content.match(/## 执行规则[\s\S]*?(?=\n## [^\s]|$)/u);
  const workflow = content.match(/## (?:Workflow|Instructions|使用说明)[\s\S]*?(?=\n## [^\s]|$)/iu);
  if (rules) lines.push(rules[0].trim(), '');
  else if (workflow) lines.push(workflow[0].trim(), '');
  else appendIntro(lines, body, maxBodyLength);
  lines.push(immediateAction());
  return lines.join('\n');
}

function appendIntro(lines: string[], body: string, maxBodyLength: number): void {
  if (!body.trim()) return;
  const firstHeading = body.match(/\n## [^\s]/u);
  const intro = firstHeading ? body.slice(0, firstHeading.index).trim() : body.trim();
  const quickStart = body.match(/## (?:快速开始|Quick\s*Start|Getting\s*Started)[\s\S]*?(?=\n## [^\s]|$)/iu);
  const authentication = body.match(/## (?:认证|Authentication|Auth)[\s\S]*?(?=\n## [^\s]|$)/iu);
  lines.push('## 指导', intro, '');
  if (!quickStart && !authentication && !(intro.length < 200 && body.length > intro.length)) return;
  const detail = [quickStart?.[0].trim(), authentication?.[0].trim()]
    .filter((value): value is string => Boolean(value))
    .join('\n\n') || body.slice(intro.length).trim();
  lines.push(detail.length > maxBodyLength
    ? `${detail.slice(0, maxBodyLength)}\n...(truncated)`
    : detail, '');
}

function immediateAction(): string {
  return '## 立即行动\n根据上面的指导，立即调用工具完成用户请求。禁止重复调用 load_skill，禁止用文本描述代替实际工具调用。';
}
