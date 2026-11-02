import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { SELF_PROFILE_FIELDS, type MediaRef, type SelfProfileChange, type SelfProfilePort } from '@zhin.js/im-contract';
import { defineAgentTool, type ToolExecutionContext } from '@zhin.js/tool';
import { z } from 'zod';
import type { ImageAssetPublisher } from '../media/image-assets.js';
import type { LocalImageAssetStore } from '../media/local-image-assets.js';
import { inspectMediaBytes } from '../media/media-normalize.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../media/media-types.js';
import { TurnNetworkClient, type NetworkTransport } from '../security/turn-network-client.js';
import { authorizedAbsolutePath } from './native-file-tools.js';

export interface NativeSelfProfileToolOptions {
  readonly imageAssets?: ImageAssetPublisher;
  readonly localAssets?: LocalImageAssetStore;
  /** The normal pinned transport is used when omitted. */
  readonly networkTransport?: NetworkTransport;
}

/** The target is always the current account; the model cannot select another Endpoint. */
export function createNativeSelfProfileToolFeatures(options: NativeSelfProfileToolOptions = {}) {
  return [
    {
      name: 'get_self_profile',
      definition: defineAgentTool<Record<string, unknown>, unknown>({
        description: 'Read your current account profile, field sources and editable fields. Refreshes platform facts; excludes other members and group cards.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        scopes: ['private', 'group', 'channel'],
        isAvailable: ({ origin }) => origin.kind === 'im',
        requiresApproval: 'never',
        readOnly: true,
        async execute(_input, context) {
          return profilePort(context).read({ signal: context.signal, refresh: true });
        },
      }),
    },
    {
      name: 'set_self_profile',
      definition: defineAgentTool<Record<string, unknown>, unknown>({
        description: 'Update one editable field of your current account with identity approval. Check get_self_profile for editable fields. Use an explicit birthday, never one inferred from age. For avatar, supply exactly one asset_id, file_path or image_url, without base64; the image becomes your account avatar. Group cards and local persona defaults are unchanged.',
        inputSchema: z.object({
          field: z.enum(SELF_PROFILE_FIELDS),
          value: z.union([z.string(), z.number().int().nonnegative(), z.array(z.string())]).optional(),
          asset_id: z.string().optional().describe('Private image resource ID belonging to this caller and conversation'),
          file_path: z.string().optional().describe('Image file inside the authorized workspace'),
          image_url: z.string().optional().describe('Existing image URL; turn network policy applies, except owned generated image URLs'),
        }).strict(),
        scopes: ['private', 'group', 'channel'],
        isAvailable: ({ origin, accountProfile }) => origin.kind === 'im' && !!accountProfile?.writableFields.length,
        requiresApproval: 'always',
        risk: 'dangerous',
        riskCategory: 'identity',
        async execute(input, context) {
          const profile = profilePort(context);
          const field = input.field;
          if (!profile.write || !profile.peek().writableFields.some(value => value === field)) {
            throw new Error(`Current account does not expose a writable ${String(field)} field`);
          }
          const change = field === 'avatar'
            ? { field: 'avatar' as const, value: await avatarReference(input, context, options) }
            : textProfileChange(input);
          return profile.write({ change, signal: context.signal });
        },
      }),
    },
  ];
}

function profilePort(context: ToolExecutionContext): SelfProfilePort {
  if (context.origin.kind !== 'im' || !context.selfProfile) throw new Error('Current account profile is unavailable outside its IM operation');
  return context.selfProfile;
}

function textProfileChange({ field, value }: Record<string, unknown>): Exclude<SelfProfileChange, { field: 'avatar' }> {
  switch (field) {
    case 'nickname': case 'signature': case 'bio':
      if (typeof value === 'string') return { field, value };
      break;
    case 'gender':
      if (value === 'male' || value === 'female' || value === 'other' || value === 'unknown') return { field, value };
      break;
    case 'age':
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return { field, value };
      break;
    case 'birthday':
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
        && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value) return { field, value };
      break;
    case 'interests':
      if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) return { field, value };
      break;
  }
  throw new TypeError(`Invalid value for self profile field ${String(field)}`);
}

async function avatarReference(
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  options: NativeSelfProfileToolOptions,
): Promise<MediaRef> {
  const sources = ['asset_id', 'file_path', 'image_url'].filter(key => input[key] !== undefined);
  if (sources.length !== 1 || input.value !== undefined) throw new TypeError('Avatar requires exactly one image reference and no inline value');
  context.signal.throwIfAborted();
  let bytes: Buffer;
  if (typeof input.asset_id === 'string' && options.localAssets) {
    ({ bytes } = await options.localAssets.read(input.asset_id, context, context.signal));
  } else if (typeof input.file_path === 'string') {
    const target = authorizedAbsolutePath(input.file_path, context);
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes) throw new Error('Avatar must be a regular image within the attachment limit');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of file.createReadStream({ end: DEFAULT_MULTIMODAL_CONFIG.maxFileBytes, autoClose: false, signal: context.signal })) {
        size += chunk.length;
        if (size > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes) throw new Error('Avatar exceeds the attachment limit');
        chunks.push(Buffer.from(chunk));
      }
      bytes = Buffer.concat(chunks, size);
    } finally { await file.close(); }
  } else if (typeof input.image_url === 'string') {
    const policy = options.imageAssets?.ownsUrl(input.image_url)
      ? { ...context.policy, network: { enabled: true, httpsOnly: true, allowedDomains: [new URL(input.image_url).hostname] } }
      : context.policy;
    const response = await new TurnNetworkClient(policy, context.signal, options.networkTransport)
      .getBytes(input.image_url, { maxBytes: DEFAULT_MULTIMODAL_CONFIG.maxFileBytes });
    if (response.status < 200 || response.status >= 300) throw new Error(`Avatar download failed (${response.status})`);
    bytes = Buffer.from(response.body);
  } else {
    throw new Error('Avatar image reference is unavailable');
  }
  const detected = inspectMediaBytes(bytes, 'image');
  if (!detected || bytes.length > DEFAULT_MULTIMODAL_CONFIG.maxFileBytes) throw new Error('Avatar requires a valid image within the attachment limit');
  return { kind: 'base64', value: bytes.toString('base64'), mime_type: detected.mimeType, size: bytes.length };
}
