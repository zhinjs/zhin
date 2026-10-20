/** @jsxImportSource @zhin.js/jsx */
import { DualSection } from '../src/layout.js';
import { KvTable } from '../src/display.js';

export const boldRows = <>
  <KvTable rows={[{ label: <b>Label</b>, value: 0, bold: true }]} />
  <DualSection
    left={{ title: 'Left', rows: [{ label: 'A', value: 'B', bold: true }] }}
    right={{ title: 'Right', rows: [{ label: 'C', value: 'D', bold: false }] }}
  />
</>;
