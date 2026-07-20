import { createHtmlRenderer, type HtmlRendererService } from '@zhin.js/html-renderer';

let _renderer: HtmlRendererService | null = null;

export function getLinkPosterRenderer(): HtmlRendererService {
  if (!_renderer) _renderer = createHtmlRenderer();
  return _renderer;
}

export function resetLinkPosterRenderer(): void {
  _renderer = null;
}
