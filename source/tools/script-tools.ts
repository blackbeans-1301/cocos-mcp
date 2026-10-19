/**
 * Project script tools. Scripts are ordinary assets, so they go through `asset-db`
 * (which also triggers Creator's own recompile on import). Reading a script is
 * `asset_read`; this group adds listing and create-or-overwrite.
 */
import type { ToolDef } from './types.js'
import { optionalString, requireString } from './types.js'
import { queryAssets, toContent } from './asset-tools.js'

const SCRIPT_URL = /\.(ts|js|mjs)$/

export const scriptTools: ToolDef[] = [
  {
    name: 'script_list',
    description: 'List the TypeScript/JavaScript scripts under db://assets (url + uuid).',
    inputSchema: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'Glob over db:// urls (default db://assets/**/*.ts).' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => queryAssets(ctx, optionalString(args, 'pattern') ?? 'db://assets/**/*.ts', undefined),
  },
  {
    name: 'script_write',
    description:
      'Create a script, or overwrite it if it exists. Creator recompiles after the write; compile errors appear in the editor console (editor_console_logs).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'e.g. db://assets/scripts/Player.ts' },
        content: { type: 'string', description: 'Full source of the file.' },
      },
      required: ['url', 'content'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const url = requireString(args, 'url')
      if (!SCRIPT_URL.test(url)) throw new Error('A script url must end in .ts, .js or .mjs.')
      const content = toContent(args['content'])
      const existing = (await ctx.bridge.request('asset-db', 'query-asset-info', url)) as { uuid?: string } | null
      if (existing?.uuid) {
        await ctx.bridge.request('asset-db', 'save-asset', existing.uuid, content)
        return { url, uuid: existing.uuid, created: false }
      }
      const created = (await ctx.bridge.request('asset-db', 'create-asset', url, content)) as { uuid?: string } | null
      return { url, uuid: created?.uuid, created: true }
    },
  },
]
