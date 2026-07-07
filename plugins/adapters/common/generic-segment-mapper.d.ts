import type { MessageElement, Segment } from 'zhin.js';
/** 通用 IM adapter：legacy wire → canonical Segment[] */
export declare function toCanonicalSegments(content: readonly MessageElement[] | readonly unknown[]): Segment[];
/** canonical → wire（mention→at；image MediaRef→legacy 字段） */
export declare function fromCanonicalSegments(segments: readonly Segment[] | Segment): MessageElement[];
//# sourceMappingURL=generic-segment-mapper.d.ts.map