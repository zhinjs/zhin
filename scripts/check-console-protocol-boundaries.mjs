#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extendedRpcDirectory = 'packages/host/http/src/console-rpc-extended';
const files = [
  'packages/console/protocol/src/index.ts',
  'packages/host/http/src/console-rpc.ts',
  ...fs.readdirSync(path.join(repoRoot, extendedRpcDirectory), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => `${extendedRpcDirectory}/${entry.name}`)
    .sort(),
  'packages/console/client/client/transport/console-transport.ts',
  'basic/cli/src/plugin-runtime/console/api-routes.ts',
];
const forbidden = [
  [/\bnormalizeConsole(?:PushType|PushMessage|RpcType|RpcMessage)\b/u, 'Console compatibility normalizer'],
  [/\bendpointSendResult\b/u, 'dual-shape endpoint send result'],
  [/["']endpoint:(?:list|info|sendMessage|friends|groups|channels|deleteFriend|groupMembers|groupKick|groupMute|groupAdmin|requests|requestApprove|requestReject|requestConsumed|noticeConsumed|inboxMessages|inboxRequests|inboxNotices)["']/u, 'legacy colon-named Console RPC'],
  [/["']\$(?:adapter|endpoint|channel_id|channel_type|content|parent|group_id|user_id|row_ids|unread_only|before_ts|before_id|limit|offset|id|value|duration|enable|remark|reason)["']/u, 'legacy dollar-prefixed Console field'],
  [/\bendpoint:\s*localName\b/u, 'legacy endpoint event alias'],
];
const violations = [];

for (const relative of files) {
  const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  for (const [pattern, label] of forbidden) {
    const match = pattern.exec(source);
    if (!match) continue;
    violations.push({
      file: relative,
      line: source.slice(0, match.index).split(/\r?\n/u).length,
      label,
    });
  }
}

const protocolSource = fs.readFileSync(
  path.join(repoRoot, 'packages/console/protocol/src/index.ts'),
  'utf8',
);
const snakeCaseContract = /readonly\s+[a-z][a-z0-9]*_[a-z0-9_]+\??\s*:/u.exec(protocolSource);
if (snakeCaseContract) {
  violations.push({
    file: 'packages/console/protocol/src/index.ts',
    line: protocolSource.slice(0, snakeCaseContract.index).split(/\r?\n/u).length,
    label: 'snake_case Console contract field',
  });
}

const hostSource = fs.readFileSync(
  path.join(repoRoot, extendedRpcDirectory, 'inbox-rpc.ts'),
  'utf8',
);
const mapperStart = hostSource.indexOf('function mapRequestRow');
const mapperEnd = hostSource.indexOf('// ---------------------------------------------------------------- consumed', mapperStart);
const mapperSource = hostSource.slice(mapperStart, mapperEnd);
const legacyResponseField = /^\s+(?:platform_(?:request|notice|message)_id|endpoint_id|sender_(?:id|name)|scene_(?:id|type)|channel_(?:id|type)|sub_type|created_at|resolved_at|consumed_at)\s*:/mu.exec(mapperSource);
if (legacyResponseField) {
  violations.push({
    file: `${extendedRpcDirectory}/inbox-rpc.ts`,
    line: hostSource.slice(0, mapperStart + legacyResponseField.index).split(/\r?\n/u).length,
    label: 'legacy snake_case Console response field',
  });
}

if (violations.length > 0) {
  console.error('Console protocol boundary check: FAILED\n');
  console.error('Use canonical dot-named RPCs with camelCase request and response payloads.\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.label}`);
  }
  process.exit(1);
}

console.log('Console protocol boundary check: passed');
