import { jsx, type JSXElement, type JSXRenderable } from '@zhin.js/jsx';
import type { MediaRef, Segment } from '@zhin.js/im-contract';
import type { Message, SendContent } from '../plugin-runtime/im/contracts.js';
import type { ButtonData } from '../built/interactive-segments/types.js';
import type { MessageTagProps } from './intrinsic-elements.js';

export type TextProps =
  | { readonly text: string; readonly children?: never }
  | { readonly children: JSXRenderable; readonly text?: never };

export function Text(props: TextProps): JSXElement {
  return jsx('text', { ...props });
}

export interface ImageProps {
  readonly src: string | MediaRef;
  readonly alt?: string;
}

/** URLs and local paths are convenient sources; opaque platform IDs use MediaRef. */
export function Image({ src, alt }: ImageProps): JSXElement {
  let media: MediaRef;
  if (typeof src !== 'string') media = src;
  else if (/^https?:\/\//i.test(src)) media = { kind: 'url', value: src };
  else if (src.startsWith('base64://')) media = { kind: 'base64', value: src.slice(9) };
  else if (src.startsWith('data:')) {
    const match = /^data:([^;,]+)(?:;[^;,]*)*;base64,([\s\S]+)$/i.exec(src);
    if (!match) throw new TypeError('Image data URI must contain base64 media');
    media = { kind: 'base64', value: match[2], mime_type: match[1] };
  } else media = { kind: 'path', value: src };
  return jsx('image', { media, ...(alt === undefined ? {} : { alt }) });
}

export interface MentionProps { readonly target: string; readonly name?: string; }
export function Mention(props: MentionProps): JSXElement { return jsx('mention', { ...props }); }

export interface FaceProps { readonly id: string | number; readonly name?: string; }
export function Face(props: FaceProps): JSXElement { return jsx('face', { ...props }); }

export type MarkdownProps = (
  | { readonly content: string; readonly children?: never }
  | { readonly children: JSXRenderable; readonly content?: never }
) & { readonly width?: number; readonly backgroundColor?: string; readonly fileName?: string };
export function Markdown(props: MarkdownProps): JSXElement {
  return jsx('markdown', { ...props });
}

/** Platform-native payload; no HTML serialization or cross-platform card schema. */
export interface CardProps { readonly data: Readonly<Record<string, unknown>>; }
export function Card({ data }: CardProps): Segment { return { type: 'card', data }; }

export type ButtonClickResult = SendContent | number | boolean | null | void;
export type ButtonClickHandler = (message: Message) => ButtonClickResult | Promise<ButtonClickResult>;
export type ButtonProps = Omit<ButtonData, 'id' | 'label' | 'payload'> & {
  readonly id?: string;
} & (
  | { readonly label: string; readonly children?: never }
  | { readonly children: string; readonly label?: never }
) & (
  | { readonly onClick: ButtonClickHandler; readonly payload?: never }
  | { readonly payload: string; readonly onClick?: never }
);

/** Event handlers are bound by the active IM operation, never serialized onto the wire. */
export function Button(props: ButtonProps): JSXElement { return jsx('button', { ...props }); }

function nativeTag<Name extends keyof MessageTagProps>(type: Name) {
  return (props: MessageTagProps[Name]): JSXElement => jsx(type, { ...props });
}

export const Audio = nativeTag('audio');
export const Video = nativeTag('video');
export const File = nativeTag('file');
export const Reply = nativeTag('reply');
export const Forward = nativeTag('forward');
export const Share = nativeTag('share');
export const Dice = nativeTag('dice');
export const Rps = nativeTag('rps');
export const Keyboard = nativeTag('keyboard');
export const Action = nativeTag('action');
export const Link = nativeTag('link');
export const Qrcode = nativeTag('qrcode');
export const Tts = nativeTag('tts');
