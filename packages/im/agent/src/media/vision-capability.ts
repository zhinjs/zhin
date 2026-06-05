import type { AIProvider, ContentPart } from '@zhin.js/ai';

export function providerSupportsVision(provider: AIProvider): boolean {
  return provider.capabilities?.vision === true;
}

/** 将 vision parts 合并为可拼进用户消息的文本说明 */
export function describeVisionPartsAsText(parts: ContentPart[]): string {
  const lines: string[] = [];
  for (const p of parts) {
    if (p.type === 'image_url') lines.push('[图片]');
    else if (p.type === 'audio') lines.push('[音频]');
    else if (p.type === 'video_url') lines.push('[视频]');
    else if (p.type === 'text' && p.text.trim()) lines.push(p.text);
  }
  return lines.join(' ');
}
