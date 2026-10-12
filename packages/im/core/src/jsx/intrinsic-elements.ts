import type { JSX as BaseJSX, JSXAttributes, HtmlProps } from '@zhin.js/jsx';
import type { MediaRef, ForwardSegment, ShareSegment } from '@zhin.js/im-contract';
import type { ButtonProps, ImageProps, MentionProps, FaceProps, TextProps, MarkdownProps } from './message-tags.js';
import type { KeyboardSegmentData, ActionSegmentData } from '../built/interactive-segments/types.js';

type MediaProps = { readonly media: MediaRef; readonly duration?: number; readonly alt?: string; readonly name?: string };
type HtmlInputProps = HtmlProps & { readonly html?: string };

/** Lowercase tags mirror Segment.type and its data fields, with typed creation helpers. */
export interface MessageTagProps {
  text: TextProps;
  image: ImageProps | { readonly media: MediaRef; readonly alt?: string };
  mention: MentionProps;
  face: FaceProps;
  audio: MediaProps;
  video: MediaProps;
  file: MediaProps;
  record: MediaProps;
  voice: MediaProps;
  reply: { readonly message_id: string };
  forward: ForwardSegment['data'];
  share: ShareSegment['data'];
  dice: { readonly result?: number };
  rps: { readonly result?: number };
  card: Readonly<Record<string, unknown>>;
  button: ButtonProps;
  keyboard: KeyboardSegmentData;
  action: ActionSegmentData;
  html: HtmlInputProps;
  markdown: MarkdownProps;
  link: { readonly url: string; readonly text?: string };
  qrcode: { readonly text: string; readonly width?: number; readonly margin?: number; readonly errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; readonly small?: boolean };
  tts: { readonly text: string; readonly voice?: string; readonly provider?: string };
}

/** Compiler namespace shared by both production and development runtime entrypoints. */
export namespace JSX {
  export type Element = BaseJSX.Element;
  export type ElementType = BaseJSX.ElementType;
  export interface ElementChildrenAttribute { children: {}; }
  export interface IntrinsicAttributes { key?: string | number; }
  export interface IntrinsicElements extends MessageTagProps {
    // HTML children and plugin-registered component names also use string tags.
    [name: string]: JSXAttributes | MessageTagProps[keyof MessageTagProps];
  }
}
