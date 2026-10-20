export interface OutputValidation {
  valid: boolean;
  cleaned: string;
  stripped: string[];
}

const LEADING_META = /^(收到|好的|好[，,。!！]|没问题|正在|已完成|为您|帮你|我(?:来|会|将))/u;
const TRAILING_META = /^(?:如果.*(?:可以|请|告诉)|还有.*需要|希望.*帮助)/u;
const SYSTEM_MARKER = /^\s*\[(?:系统|任务|调度|schedule)\]\s*/iu;

export function validateScheduleOutput(output: string): OutputValidation {
  const stripped: string[] = [];
  const paragraphs = output
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n|\n/)
    .map(part => part.trim())
    .map(part => {
      if (!SYSTEM_MARKER.test(part)) return part;
      const cleaned = part.replace(SYSTEM_MARKER, '').trim();
      if (!cleaned || LEADING_META.test(cleaned)) {
        stripped.push(part);
        return '';
      }
      stripped.push(part.slice(0, part.length - cleaned.length));
      return cleaned;
    })
    .filter(Boolean);
  while (paragraphs.length > 0) {
    const first = paragraphs[0];
    if (LEADING_META.test(first)) {
      stripped.push(paragraphs.shift()!);
      continue;
    }
    break;
  }
  while (paragraphs.length > 0 && TRAILING_META.test(paragraphs[paragraphs.length - 1])) {
    stripped.push(paragraphs.pop()!);
  }

  const cleaned = paragraphs.join('\n\n').trim();
  return { valid: cleaned.length > 0, cleaned, stripped };
}
