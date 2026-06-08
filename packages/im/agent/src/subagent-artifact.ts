/**
 * 超长子 agent 结果落盘 artifact，父 agent 仅收摘要 + 路径
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from './discovery/utils.js';

export const SUBAGENT_ARTIFACT_THRESHOLD = 8192;
const SUMMARY_PREVIEW_CHARS = 2000;

export function writeSubagentArtifact(taskId: string, content: string): string {
  const dir = path.join(getDataDir(), 'artifacts', 'subagent');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${taskId}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function packageSubagentResult(
  result: string,
  taskId: string,
  threshold = SUBAGENT_ARTIFACT_THRESHOLD,
): { text: string; artifactPath?: string } {
  if (result.length <= threshold) {
    return { text: result };
  }
  const artifactPath = writeSubagentArtifact(taskId, result);
  const preview = result.slice(0, SUMMARY_PREVIEW_CHARS).trim();
  const suffix = result.length > SUMMARY_PREVIEW_CHARS ? '\n…[truncated]' : '';
  const text = `${preview}${suffix}\n\n[完整结果已写入 artifact: ${artifactPath}]`;
  return { text, artifactPath };
}
