import { createMarkdownRenderer } from 'vitepress';
import { readFile, writeFile } from 'node:fs/promises';
const md = await createMarkdownRenderer(process.cwd(), {}, undefined, console);
const src = await readFile('architecture/target-implementation/plugin-monorepo-and-features.md', 'utf8');
const html = md.render(src);
await writeFile('/tmp/rendered.html', html);
console.log('written', html.length);
