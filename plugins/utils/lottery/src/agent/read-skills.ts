import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function readSkillMarkdown(...parts: string[]): string {
  const chunks: string[] = [];
  for (const p of parts) {
    const full = path.join(PLUGIN_ROOT, 'skills', p, 'SKILL.md');
    if (fs.existsSync(full)) {
      chunks.push(fs.readFileSync(full, 'utf8'));
    }
  }
  return chunks.join('\n\n---\n\n');
}

export function buildLotteryAgentSystemPrompt(): string {
  const skills = readSkillMarkdown('lottery');
  return [
    '你是 Zhin 彩票分析 Agent。使用当前彩票插件提供的工具查库，算法流程见 skills。',
    '可用 web_search 检索公开分析资料；推荐号码只能来自“Compute lottery recommendation”工具，不得臆造或篡改。',
    '需要保存推荐时必须调用“Save a pending lottery prediction”工具，不得声称已保存但未调用。',
    '',
    skills || '(skills 未加载，请依赖工具返回的统计数据。)',
  ].join('\n');
}
