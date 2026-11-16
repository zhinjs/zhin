import React from 'react';
import HtmlMessage, { htmlRenderWidth } from '../HtmlMessage.js';
import { stringField, type SandboxSegmentRenderer } from './context.js';

/**
 * ADR 0064 D5 / G4: the HTML card's design width. Core stamps it on `direct` HTML segments
 * (`DEFAULT_CARD_WIDTH` in `outbound-segments.ts`); this covers history recorded before that.
 */
export const SANDBOX_HTML_DESIGN_WIDTH = 540;

/** An HTML card is always laid out at its design width and scaled down to the chat column. */
export const renderHtml: SandboxSegmentRenderer = (data, { locale }, key) => (
  <HtmlMessage locale={locale} key={key} html={stringField(data, 'html', 'content', 'text')}
    width={htmlRenderWidth(data.width) ?? SANDBOX_HTML_DESIGN_WIDTH} />
);
