/**
 * Asset tools — routed to the editor's `asset-db` module, which is the API the
 * Asset panel itself uses. `create` takes raw content the caller supplies; this
 * extension does not synthesise asset formats.
 */
import type { ToolDef, ToolContext } from './types.js'
import { defined, optionalString, requireString } from './types.js'

/** Accept a uuid or a db:// url (asset-db accepts either in most messages). */
const target = (args: Record<string, unknown>): string => {
  const uuid = optionalString(args, 'uuid')
  const url = optionalString(args, 'url')
  if (!uuid && !url) throw new Error('Provide "uuid" or "url".')
  return uuid ?? (url as string)
}

/** asset-db wants string content; objects (JSON assets) are serialised. */
export const toContent = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

/** Slim an asset-db record to what an agent needs (the raw records are huge). */
export const slimAssets = (raw: unknown): unknown =>
  Array.isArray(raw)
    ? raw.map((a) => {
        const r = (a ?? {}) as Record<string, unknown>
        return { url: r['url'], uuid: r['uuid'], type: r['type'], name: r['name'] }
      })
    : raw

/** `query-assets` filters by `ccType`/`pattern`; an unknown `type` key is silently ignored. */
export const queryAssets = async (ctx: ToolContext, pattern: string | undefined, ccType: string | undefined): Promise<unknown> =>
  slimAssets(await ctx.bridge.request('asset-db', 'query-assets', defined({ pattern: pattern ?? 'db://assets/**', ccType })))

export const assetTools: ToolDef[] = [
  {
    name: 'asset_query',
    description: 'Query assets by glob pattern and/or asset type (e.g. "cc.Texture2D", "cc.AudioClip", "cc.SpriteFrame").',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob over db:// urls, e.g. db://assets/**/*.png.' },
        type: { type: 'string', description: 'Asset type, e.g. cc.Texture2D.' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => queryAssets(ctx, optionalString(args, 'pattern'), optionalString(args, 'type')),
  },
  {
    name: 'asset_info',
    description: 'Read the asset-db record for one asset (uuid or db:// url).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => ctx.bridge.request('asset-db', 'query-asset-info', target(args)),
  },
  {
    name: 'asset_create',
    description: 'Create an asset from raw content at a db:// url.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'e.g. db://assets/data/level.json' },
        content: { description: 'Raw content (string, or JSON value).' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      ctx.bridge.request('asset-db', 'create-asset', requireString(args, 'url'), toContent(args['content']), { overwrite: true }),
  },
  {
    name: 'asset_save',
    description: 'Overwrite an asset with new raw content.',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' }, content: {} },
      required: ['content'],
      additionalProperties: false,
    },
    handler: (args, ctx) => ctx.bridge.request('asset-db', 'save-asset', target(args), toContent(args['content'])),
  },
  {
    name: 'asset_move',
    description: 'Move/rename an asset. Both source and target are db:// urls.',
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string' }, target: { type: 'string' } },
      required: ['source', 'target'],
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      ctx.bridge.request('asset-db', 'move-asset', requireString(args, 'source'), requireString(args, 'target'), { overwrite: true }),
  },
  {
    name: 'asset_delete',
    description: 'Delete an asset (uuid or db:// url).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => ctx.bridge.request('asset-db', 'delete-asset', target(args)),
  },
  {
    name: 'asset_reimport',
    description: 'Re-import an asset (re-run its importer).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => ctx.bridge.request('asset-db', 'reimport-asset', target(args)),
  },
  {
    name: 'asset_open',
    description: 'Open an asset in the editor (double-click equivalent).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => ctx.bridge.request('asset-db', 'open-asset', target(args)),
  },
]
