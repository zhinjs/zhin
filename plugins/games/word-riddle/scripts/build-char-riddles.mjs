/**
 * 从 riddle_demo CSV 生成字谜 JSON
 * @see https://github.com/ytygxfmgzx/riddle_demo
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'src/data/char-riddles.json');
const CACHE = join(ROOT, 'data/riddles.csv');
const CSV_URL =
  'https://raw.githubusercontent.com/ytygxfmgzx/riddle_demo/main/content/riddles/riddles_260415_utf8.csv';

const CHAR_HINTS = new Set(['字谜', '打一字']);

async function loadCsv() {
  try {
    return await readFile(CACHE, 'utf8');
  } catch {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error(`Failed to download CSV: ${res.status}`);
    const text = await res.text();
    await mkdir(dirname(CACHE), { recursive: true });
    await writeFile(CACHE, text, 'utf8');
    return text;
  }
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  const entries = [];
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 4) continue;

    const sourceId = parts[0]?.trim();
    const question = parts[1]?.trim();
    const hint = parts[2]?.trim();
    const answer = parts[3]?.trim();
    const explanation = parts[4]?.trim();

    if (!sourceId || !question || !answer || !CHAR_HINTS.has(hint)) continue;
    if ([...answer].length !== 1) continue;

    const key = `${question}\0${answer}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry = {
      id: `c:${sourceId}`,
      type: 'char',
      question: question.includes('打') ? question : `${question}（打一字）`,
      answer,
    };
    if (hint) entry.hint = hint;
    if (explanation) entry.explanation = explanation;
    entries.push(entry);
  }

  return entries;
}

const csv = await loadCsv();
const entries = parseCsv(csv);
await writeFile(OUT, JSON.stringify(entries), 'utf8');
console.log(`Wrote ${entries.length} char riddles → ${OUT}`);
