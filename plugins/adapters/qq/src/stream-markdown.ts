import { EndpointDeliveryError } from '@zhin.js/im-contract';

interface Fence { readonly marker: string; readonly info: string; }

/** Only source-level fenced context is portable to a fresh native Markdown message. */
export function qqMarkdownContinuation(precedingText: string): { readonly opening: string } {
  if (!precedingText) return { opening: '' };
  const fence = openFence(precedingText);
  if (fence) {
    if (!precedingText.includes('\n', fence.offset)) throw unsupported();
    return { opening: `${fence.marker}${fence.info}\n` };
  }
  if (/(?:^|\n) {0,3}(?:`{3,}|~{3,})[ \t]*\n?$/.test(precedingText)) return { opening: '' };
  const boundary = precedingText.lastIndexOf('\n\n');
  const block = precedingText.slice(boundary >= 0 ? boundary + 2 : 0);
  // No native contract permits retroactively recreating an unfinished inline
  // construct in another message. Admit plain continuations and closed blocks.
  if (/[`*_\[\]~]/.test(block)) throw unsupported();
  return { opening: '' };
}

export function qqMarkdownClosing(source: string): string {
  const fence = openFence(source);
  return fence ? `${source.endsWith('\n') ? '' : '\n'}${fence.marker}` : '';
}

function openFence(source: string): (Fence & { readonly offset: number }) | undefined {
  let active: (Fence & { readonly offset: number }) | undefined;
  for (const line of source.matchAll(/^ {0,3}(`{3,}|~{3,})([^\n]*)/gm)) {
    const marker = line[1], info = line[2];
    if (active) {
      if (marker[0] === active.marker[0] && marker.length >= active.marker.length && !info.trim()) active = undefined;
    } else if (marker[0] !== '`' || !info.includes('`')) active = { marker, info, offset: line.index };
  }
  return active;
}

function unsupported(): EndpointDeliveryError {
  return new EndpointDeliveryError('unsupported_operation',
    'QQ Markdown continuation requires a plain block boundary or a complete fenced-code header', 'not_sent');
}
