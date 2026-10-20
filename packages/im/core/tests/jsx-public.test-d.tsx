import type { SendContent as PublicContent, Message } from 'zhin.js';
import type { SendContent as RuntimeContent } from 'zhin.js/core/runtime';
import type { SendContent as CoreContent } from '@zhin.js/core';
import { defineCommand } from 'zhin.js/command';
import { defineComponent, component } from 'zhin.js/component';
import { defineMiddleware } from 'zhin.js/middleware';
import type { JSXNode } from 'zhin.js/jsx';
import { Card, CardHeader, KvTable, Badge } from '@zhin.js/components';
import { raw } from '../src/plugin-runtime/im/contracts.js';
import { asMessageElements, collectOutboundMediaKinds } from '../src/built/outbound-media-utils.js';

async function AsyncValue(): Promise<JSXNode> { return <b>ready</b>; }
const node = <html><Card><CardHeader title={<AsyncValue />} badge={<Badge>online</Badge>} /><KvTable rows={[{ label: <i>RSS</i>, value: <b>42MB</b> }]} /></Card></html>;
const nativeMessage: PublicContent = <>
  hello
  <text>world</text>
  <image src="https://example.com/image.png" />
  <image media={{ kind: 'url', value: 'https://example.com/image.png' }} />
  <mention target="123" /><face id={42} />
  <share title="海阔天空" url="https://music.163.com/#/song?id=387717" config={{ appid: 100495085 }} />
  <card header={{ title: 'platform card' }} />
  <markdown>**hello**</markdown>
  <button onClick={(message) => <text>{message.sender?.name ?? 'clicked'}</text>}>click</button>
  <audio media={{ kind: 'url', value: 'https://example.com/audio.mp3' }} />
  <video media={{ kind: 'url', value: 'https://example.com/video.mp4' }} />
  <file media={{ kind: 'path', value: './report.txt' }} name="report.txt" />
  <reply message_id="m1" /><forward forward_id="f1" /><dice result={6} /><rps result={1} />
  <keyboard rows={[[{ id: 'b', label: 'go', payload: 'next' }]]} />
  <action id="b" payload="next" /><link url="https://example.com" /><qrcode text="hello" /><tts text="hello" />
</>;
void nativeMessage;
// @ts-expect-error Native share requires a URL and title.
const missingShareUrl = <share title="missing" />;
// @ts-expect-error Native image requires a canonical media reference or src.
const missingImageSource = <image />;
// @ts-expect-error Native mention target must be a string.
const numericMention = <mention target={123} />;
// @ts-expect-error Native onClick is a function, not a DOM event string.
const invalidClick = <button label="click" onClick="alert(1)" />;
// @ts-expect-error Native button requires a click callback or a platform payload.
const missingButtonAction = <button label="click" />;
void [missingShareUrl, missingImageSource, numericMention, invalidClick, missingButtonAction];
const publicContent: PublicContent = node;
const runtimeContent: RuntimeContent = publicContent;
const coreContent: CoreContent = runtimeContent;
defineCommand({ execute: () => coreContent });
defineComponent({ render: () => node });
defineMiddleware<Message>({ handle: () => node });
defineMiddleware<Message>({ handle: (_context, next) => next() });
const call: PublicContent = component('status-card', { title: node });
void call;
asMessageElements(['text', [{ type: 'text', data: { text: 'rendered' } }]]);
// @ts-expect-error JSX must be evaluated by OutboundRenderer before segment inspection.
asMessageElements(node);
// @ts-expect-error A ComponentCall is authoring content, not rendered segments.
asMessageElements(component('status-card', {}));
// @ts-expect-error RawContent wrappers must first be unwrapped by OutboundRenderer.
asMessageElements(raw('wire content'));
// @ts-expect-error Nested authoring content is excluded from media inspection too.
collectOutboundMediaKinds(['text', [node]]);
// @ts-expect-error Outbound replacement uses envelope.replace; its handle returns void.
defineMiddleware({
  target: 'outbound',
  handle: async () => node,
});

// @ts-expect-error HTML string and children are mutually exclusive.
const mixedHtml = <html html="<b>raw</b>"><b>child</b></html>;
// @ts-expect-error Audio accepts duration, not file names.
const audioName = <audio media={{ kind: 'url', value: 'https://example.com/a.mp3' }} name="a" />;
// @ts-expect-error File accepts name, not duration.
const fileDuration = <file media={{ kind: 'path', value: 'a.txt' }} duration={10} />;
// @ts-expect-error Card payload is opaque data, not a JSX layout container.
const cardChildren = <card><b>child</b></card>;
void [mixedHtml, audioName, fileDuration, cardChildren];
