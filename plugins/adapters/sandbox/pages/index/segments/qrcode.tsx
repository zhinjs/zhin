import type { ConsoleLocale } from '@zhin.js/client';
import React, { useMemo } from 'react';
import QRCode from 'qrcode';
import { sandboxText } from '../messages.js';
import { stringField, type SandboxSegmentRenderer } from './context.js';

/**
 * ADR 0064 G6: the QR code is generated in the page with the same library Core uses
 * (`generated-qrcode.ts`), as an SVG path of its module matrix — no canvas, no image URL, no network.
 * `undefined` when the text does not fit a QR code.
 */
export function qrCodePath(text: string): { readonly size: number; readonly path: string } | undefined {
  if (!text) return undefined;
  try {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const size = modules.size;
    let path = '';
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        if (modules.get(row, column)) path += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { size, path };
  } catch {
    return undefined;
  }
}

function QrCodeMessage({ text, locale }: { readonly text: string; readonly locale: ConsoleLocale }) {
  const code = useMemo(() => qrCodePath(text), [text]);
  const margin = 2;
  return (
    <figure className="sandbox-qrcode">
      {code
        ? <svg className="sandbox-qrcode-image" role="img" aria-label={sandboxText(locale, "二维码：{0}", [text])}
          viewBox={`${-margin} ${-margin} ${code.size + margin * 2} ${code.size + margin * 2}`} shapeRendering="crispEdges">
          <rect x={-margin} y={-margin} width={code.size + margin * 2} height={code.size + margin * 2} className="sandbox-qrcode-light" />
          <path d={code.path} className="sandbox-qrcode-dark" />
        </svg>
        : <span className="sandbox-qrcode-error">{sandboxText(locale, "内容过长，无法生成二维码")}</span>}
      <figcaption className="sandbox-qrcode-text">{text}</figcaption>
    </figure>
  );
}

export const renderQrcode: SandboxSegmentRenderer = (data, { locale }, key) => (
  <QrCodeMessage key={key} text={stringField(data, 'text', 'content', 'url')} locale={locale} />
);
