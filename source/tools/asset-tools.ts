/**
 * Asset tools — routed to the editor's `asset-db` module, which is the API the
 * Asset panel itself uses. `create` takes raw content the caller supplies; this
 * extension does not synthesise asset formats.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { ToolDef, ToolContext } from './types.js'
import { defined, optionalNumber, optionalString, requireString } from './types.js'

/** Accept a uuid or a db:// url (asset-db accepts either in most messages). */
const target = (args: Record<string, unknown>): string => {
  const uuid = optionalString(args, 'uuid')
  const url = optionalString(args, 'url')
  if (!uuid && !url) throw new Error('Provide "uuid" or "url".')
  return uuid ?? (url as string)
}

/** On-disk file of an asset (uuid or db:// url), from its asset-db record. */
export const assetFile = async (ctx: ToolContext, args: Record<string, unknown>): Promise<string> => {
  const info = (await ctx.bridge.request('asset-db', 'query-asset-info', target(args))) as { file?: string } | null
  if (!info?.file) throw new Error('Asset not found.')
  return info.file
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
  {
    name: 'asset_read',
    description: 'Read the text content of an asset (script, json, scene, prefab, …). Binary files are refused.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        url: { type: 'string' },
        maxBytes: { type: 'number', description: 'Refuse files larger than this (default 1048576).' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const file = await assetFile(ctx, args)
      if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Not a file: ${file}`)
      const max = optionalNumber(args, 'maxBytes') ?? 1048576
      if (statSync(file).size > max) throw new Error(`File is larger than ${max} bytes; raise "maxBytes" to read it.`)
      const buffer = readFileSync(file)
      if (buffer.includes(0)) throw new Error('Binary asset — not readable as text.')
      return { file, content: buffer.toString('utf8') }
    },
  },
  {
    name: 'asset_import',
    description: 'Import a file from disk into the project (copies it to a db:// url and imports it).',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Absolute path of the file on disk.' },
        url: { type: 'string', description: 'Target url, e.g. db://assets/textures/hero.png.' },
      },
      required: ['source', 'url'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const source = requireString(args, 'source')
      if (!existsSync(source)) throw new Error(`No such file: ${source}`)
      return ctx.bridge.request('asset-db', 'import-asset', source, requireString(args, 'url'), { overwrite: true })
    },
  },
  {
    name: 'asset_copy',
    description: 'Copy an asset to another db:// url.',
    inputSchema: {
      type: 'object',
      properties: { source: { type: 'string' }, target: { type: 'string' } },
      required: ['source', 'target'],
      additionalProperties: false,
    },
    handler: (args, ctx) => ctx.bridge.request('asset-db', 'copy-asset', requireString(args, 'source'), requireString(args, 'target')),
  },
  {
    name: 'asset_mkdir',
    description: 'Create a folder at a db:// url.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'e.g. db://assets/prefabs' } },
      required: ['url'],
      additionalProperties: false,
    },
    handler: (args, ctx) => ctx.bridge.request('asset-db', 'create-asset', requireString(args, 'url'), null),
  },
  {
    name: 'asset_dependencies',
    description: 'What an asset depends on, and (with users: true) which assets/scenes use it.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        url: { type: 'string' },
        users: { type: 'boolean', description: 'Return the assets that use this one instead (default false).' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const info = (await ctx.bridge.request('asset-db', 'query-asset-info', target(args))) as { uuid?: string } | null
      if (!info?.uuid) throw new Error('Asset not found.')
      return ctx.bridge.request('asset-db', args['users'] === true ? 'query-asset-users' : 'query-asset-dependencies', info.uuid)
    },
  },
]
