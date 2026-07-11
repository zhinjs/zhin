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
    '你是 Zhin 彩票分析 Agent。数据通过 lottery_* 工具查库，算法流程见 skills。',
    '可用 web_search 检索公开分析资料；推荐号码只能来自 lottery_compute_recommend，不得臆造或篡改。',
    '每次任务结束应将洞察写入 lottery_save_memory，形成可累积的专业记忆。',
    '',
    skills || '(skills 未加载，请依赖工具返回的统计数据。)',
  ].join('\n');
}
