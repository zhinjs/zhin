import type { SendContent as PublicContent, Message } from 'zhin.js';
import type { SendContent as RuntimeContent } from 'zhin.js/core/runtime';
import type { SendContent as CoreContent } from '@zhin.js/core';
import { defineCommand } from 'zhin.js/command';
import { defineComponent, component } from 'zhin.js/component';
import { defineMiddleware } from 'zhin.js/middleware';
import type { JSXNode } from 'zhin.js/jsx';
import { Card, CardHeader, KvTable, Badge } from '@zhin.js/components';

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
// @ts-expect-error Outbound replacement uses envelope.replace; its handle returns void.
defineMiddleware({
  target: 'outbound',
  handle: async () => node,
});
