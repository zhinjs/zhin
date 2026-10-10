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
const node = <Card><CardHeader title={<AsyncValue />} badge={<Badge>online</Badge>} /><KvTable rows={[{ label: <i>RSS</i>, value: <b>42MB</b> }]} /></Card>;
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
