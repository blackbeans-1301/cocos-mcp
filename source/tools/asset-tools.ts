/**
 * Asset tools — routed to the editor's `asset-db` module, which is the API the
 * Asset panel itself uses. `create` takes raw content the caller supplies; this
 * extension does not synthesise asset formats.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import type { ToolDef, ToolContext } from './types.js'
import { defined, optionalBoolean, optionalNumber, optionalObject, optionalString, requireString, ToolInputError } from './types.js'

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

/** asset-db answers `null` for several successful operations; say what happened instead. */
const confirm = async (pending: Promise<unknown>, done: Record<string, unknown>): Promise<unknown> => {
  const result = await pending
  return result === null || result === undefined ? { ok: true, ...done } : result
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

/** Read the asset-db record, failing loudly when there is none (asset-db answers `null`). */
export const requireAssetInfo = async (ctx: ToolContext, ref: string): Promise<Record<string, unknown>> => {
  const info = (await ctx.bridge.request('asset-db', 'query-asset-info', ref)) as Record<string, unknown> | null
  if (!info) throw new Error(`No asset found for "${ref}".`)
  return info
}

/** Recursively merge `patch` into `base` (plain objects merge, everything else is replaced). */
const mergeDeep = (base: unknown, patch: unknown): unknown => {
  if (!isPlain(base) || !isPlain(patch)) return patch
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) out[key] = key in out ? mergeDeep(out[key], value) : value
  return out
}
const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const assetTools: ToolDef[] = [
  {
    name: 'asset_query',
    description:
      'Query assets by glob pattern and/or asset type (e.g. "cc.Texture2D", "cc.AudioClip", "cc.SpriteFrame"). Sub-assets (a texture\'s spriteFrame/texture) are left out unless you pass a type or includeSubAssets. Returns { total, returned, truncated, assets }.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob over db:// urls, e.g. db://assets/**/*.png.' },
        type: { type: 'string', description: 'Asset type, e.g. cc.Texture2D.' },
        limit: { type: 'number', description: 'Max assets to return (default 100).' },
        includeSubAssets: { type: 'boolean', description: 'Include sub-assets such as <image>/spriteFrame (default: only when "type" is given).' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const type = optionalString(args, 'type')
      const includeSub = optionalBoolean(args, 'includeSubAssets') ?? type !== undefined
      const all = (await queryAssets(ctx, optionalString(args, 'pattern'), type)) as Array<Record<string, unknown>>
      const matches = includeSub ? all : all.filter((asset) => !String(asset['uuid'] ?? '').includes('@'))
      const limit = Math.max(1, optionalNumber(args, 'limit') ?? 100)
      return { total: matches.length, returned: Math.min(limit, matches.length), truncated: matches.length > limit, assets: matches.slice(0, limit) }
    },
  },
  {
    name: 'asset_info',
    description: 'Read the asset-db record for one asset (uuid or db:// url).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => requireAssetInfo(ctx, target(args)),
  },
  {
    name: 'asset_refresh',
    description: 'Re-scan an asset or folder on disk so the asset db picks up files changed outside the editor (omit url to refresh all of db://assets).',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'db:// url of an asset or folder (default db://assets).' } },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const url = optionalString(args, 'url') ?? 'db://assets'
      await ctx.bridge.request('asset-db', 'refresh-asset', url)
      return { ok: true, refreshed: url }
    },
  },
  {
    name: 'asset_meta_get',
    description: 'Read an asset\'s .meta: importer and userData (import settings such as texture compression, sprite border/trim, audio).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const info = await requireAssetInfo(ctx, target(args))
      const meta = (await ctx.bridge.request('asset-db', 'query-asset-meta', info['uuid'])) as Record<string, unknown> | null
      if (!meta) throw new Error('This asset has no .meta.')
      return { uuid: info['uuid'], url: info['url'], importer: meta['importer'], userData: meta['userData'] ?? {}, subMetas: Object.keys((meta['subMetas'] as object | undefined) ?? {}) }
    },
  },
  {
    name: 'asset_meta_set',
    description:
      'Change an asset\'s import settings: `userData` is deep-merged into the existing .meta userData, then the asset is re-imported. Read it first with asset_meta_get.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        url: { type: 'string' },
        userData: { type: 'object', description: 'Partial userData to merge, e.g. {"compressSettings":{"useCompressTexture":true}}.' },
      },
      required: ['userData'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const patch = optionalObject(args, 'userData')
      if (!patch) throw new ToolInputError('"userData" must be an object.')
      const info = await requireAssetInfo(ctx, target(args))
      const meta = (await ctx.bridge.request('asset-db', 'query-asset-meta', info['uuid'])) as Record<string, unknown> | null
      if (!meta) throw new Error('This asset has no .meta.')
      const userData = mergeDeep(meta['userData'] ?? {}, patch)
      await ctx.bridge.request('asset-db', 'save-asset-meta', info['uuid'], JSON.stringify({ ...meta, userData }))
      await ctx.bridge.request('asset-db', 'reimport-asset', info['uuid'])
      return { ok: true, uuid: info['uuid'], userData }
    },
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
      confirm(
        ctx.bridge.request('asset-db', 'move-asset', requireString(args, 'source'), requireString(args, 'target'), { overwrite: true }),
        { moved: requireString(args, 'source'), to: requireString(args, 'target') },
      ),
  },
  {
    name: 'asset_delete',
    description: 'Delete an asset (uuid or db:// url).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => confirm(ctx.bridge.request('asset-db', 'delete-asset', target(args)), { deleted: target(args) }),
  },
  {
    name: 'asset_reimport',
    description: 'Re-import an asset (re-run its importer).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => confirm(ctx.bridge.request('asset-db', 'reimport-asset', target(args)), { reimported: target(args) }),
  },
  {
    name: 'asset_open',
    description: 'Open an asset in the editor (double-click equivalent).',
    inputSchema: {
      type: 'object',
      properties: { uuid: { type: 'string' }, url: { type: 'string' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => confirm(ctx.bridge.request('asset-db', 'open-asset', target(args)), { opened: target(args) }),
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
