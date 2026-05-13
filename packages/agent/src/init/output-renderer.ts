import type { OutputElement } from '@zhin.js/ai';

export function renderOutput(elements: OutputElement[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    switch (el.type) {
      case 'text':
        if (el.content) parts.push(el.content);
        break;
      case 'image':
        parts.push(`<image url="${el.url}"/>`);
        break;
      case 'audio':
        parts.push(`<audio url="${el.url}"/>`);
        break;
      case 'video':
        parts.push(`<video url="${el.url}"/>`);
        break;
      case 'card': {
        const cp = [`📋 ${el.title}`];
        if (el.description) cp.push(el.description);
        if (el.fields?.length) {
          for (const f of el.fields) cp.push(`  ${f.label}: ${f.value}`);
        }
        if (el.imageUrl) cp.push(`<image url="${el.imageUrl}"/>`);
        parts.push(cp.join('\n'));
        break;
      }
      case 'file':
        parts.push(`📎 ${el.name}: ${el.url}`);
        break;
    }
  }
  return parts.join('\n') || '';
}

