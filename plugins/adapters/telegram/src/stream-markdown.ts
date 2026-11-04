import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { projectTelegramMarkdown } from './markdown-to-html.js';

interface HtmlTag { readonly name: string; readonly html: string; }
interface VisibleUnit {
  readonly html: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly tags: readonly HtmlTag[];
}

/** Render a physical slice while retaining the original Markdown's source coordinates. */
export function sliceTelegramMarkdown(text: string, precedingText: string, capacity: number): {
  readonly html: string;
  readonly acceptedText: string;
  readonly exhausted: boolean;
} {
  const full = precedingText + text;
  const projection = projectTelegramMarkdown(full);
  const units: VisibleUnit[] = [];
  const tags: HtmlTag[] = [];
  const trimStart = projection.html.length - projection.html.trimStart().length;
  const trimEnd = projection.html.trimEnd().length;
  const html = projection.html.slice(trimStart, trimEnd);
  const matcher = /<\/?[a-z][^>]*>|&(?:amp|lt|gt|quot);|[\s\S]/gu;
  for (const match of html.matchAll(matcher)) {
    const raw = match[0];
    if (raw.startsWith('<')) {
      const tag = /^<(\/?)([a-z]+)/.exec(raw)!;
      if (tag[1]) {
        if (tags.at(-1)?.name !== tag[2]) throw unsupportedProjection();
        tags.pop();
      } else tags.push({ name: tag[2], html: raw });
      continue;
    }
    const origins = projection.source.slice(trimStart + match.index, trimStart + match.index + raw.length).filter(position => position >= 0);
    if (!origins.length) throw unsupportedProjection();
    const sourceStart = Math.min(...origins), sourceEnd = Math.max(...origins) + 1;
    if (sourceEnd > precedingText.length) units.push({ html: raw, sourceStart, sourceEnd, tags: [...tags] });
  }
  if (tags.length) throw unsupportedProjection();
  if (!units.length) return { html: '', acceptedText: text, exhausted: false };

  // One decoded code point is one unit. Keep replacement expansions together
  // when their source positions coincide (for example a Markdown bullet).
  let take = Math.min(capacity, units.length);
  while (take > 0 && take < units.length && units[take].sourceStart < units[take - 1].sourceEnd) take--;
  if (take <= 0) throw new EndpointDeliveryError('stream_capacity', 'Telegram prefix leaves no room for a Markdown unit', 'not_sent');
  const end = take < units.length ? units[take].sourceStart : full.length;
  if (end <= precedingText.length) throw unsupportedProjection();
  let rendered = '';
  let active: readonly HtmlTag[] = [];
  for (const unit of units.slice(0, take)) {
    let common = 0;
    while (common < active.length && common < unit.tags.length && active[common].html === unit.tags[common].html) common++;
    for (let index = active.length - 1; index >= common; index--) rendered += `</${active[index].name}>`;
    for (const tag of unit.tags.slice(common)) rendered += tag.html;
    rendered += unit.html;
    active = unit.tags;
  }
  for (let index = active.length - 1; index >= 0; index--) rendered += `</${active[index].name}>`;
  return { html: rendered, acceptedText: text.slice(0, end - precedingText.length), exhausted: take < units.length || take === capacity };
}

function unsupportedProjection(): EndpointDeliveryError {
  return new EndpointDeliveryError('unsupported_operation', 'Telegram Markdown projection has no safe source mapping', 'not_sent');
}
