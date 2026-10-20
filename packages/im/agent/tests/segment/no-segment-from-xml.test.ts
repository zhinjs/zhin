import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const aiRoot = path.resolve(agentRoot, '../ai');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'lib') continue;
      walkTs(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('agent/ai LLM path — no segment.from XML', () => {
  const agentFiles = walkTs(path.join(agentRoot, 'src'));
  const aiFiles = walkTs(path.join(aiRoot, 'src'));

  it('agent package does not call segment.from', () => {
    const hits = agentFiles.filter((f) => readFileSync(f, 'utf8').includes('segment.from'));
    expect(hits).toEqual([]);
  });

  it('ai package does not call segment.from', () => {
    const hits = aiFiles.filter((f) => readFileSync(f, 'utf8').includes('segment.from'));
    expect(hits).toEqual([]);
  });
});
