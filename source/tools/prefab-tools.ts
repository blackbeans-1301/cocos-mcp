/**
 * Prefab tools. Listing/reading prefab assets uses `asset-db`; instantiating a
 * prefab into the scene runs in the engine (scene script), because it needs a
 * live scene to attach the node to.
 */
import type { ToolDef, ToolContext } from './types.js'
import { queryAssets, requireAssetInfo } from './asset-tools.js'
import { defined, optionalArray, optionalString, requireString, ToolInputError } from './types.js'

const VEC3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z]' }

/** A tool that sends one `scene` message with the uuid of a prefab-instance node. */
const prefabNodeTool = (name: string, description: string, message: string): ToolDef => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties: {
      uuid: { type: 'string', description: 'Node uuid of the prefab instance.' },
      path: { type: 'string', description: 'Node path (used when uuid is absent).' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    let uuid = optionalString(args, 'uuid')
    if (!uuid) {
      const path = optionalString(args, 'path')
      if (!path) throw new ToolInputError('Provide "uuid" or "path".')
      uuid = ((await ctx.bridge.scene('getNode', [{ path }])) as { uuid: string }).uuid
    }
    // Fails with "is not part of a prefab instance" — Creator's own messages silently do nothing on a plain node.
    const info = (await ctx.bridge.scene('getPrefabInfo', [{ uuid }])) as { assetUuid: string; rootUuid: string }
    if (message === 'restore-prefab') {
      // Reverting needs the instance root and the prefab asset: (rootUuid, assetUuid).
      await ctx.bridge.request('scene', message, info.rootUuid, info.assetUuid)
      return { ok: true, uuid: info.rootUuid, prefab: info.assetUuid }
    }
    await ctx.bridge.request('scene', message, uuid)
    return { ok: true, uuid }
  },
})

export const prefabTools: ToolDef[] = [
  {
    name: 'prefab_list',
    description: 'List the prefab assets in the project (url + uuid).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, ctx) => queryAssets(ctx, 'db://assets/**/*.prefab', 'cc.Prefab'),
  },
  {
    name: 'prefab_info',
    description: 'Read an asset-db record for a prefab by uuid or db:// url.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string' },
        url: { type: 'string', description: 'e.g. db://assets/Prefabs/Enemy.prefab' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const uuid = optionalString(args, 'uuid')
      const url = optionalString(args, 'url')
      if (!uuid && !url) return queryAssets(ctx, 'db://assets/**/*.prefab', 'cc.Prefab')
      return requireAssetInfo(ctx, (uuid ?? url) as string)
    },
  },
  {
    name: 'prefab_instantiate',
    description: 'Instantiate a prefab asset into the scene under a parent (defaults to the scene root).',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'Prefab asset uuid.' },
        parentUuid: { type: 'string' },
        parentPath: { type: 'string' },
        position: VEC3,
      },
      required: ['uuid'],
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      ctx.bridge.scene('instantiatePrefab', [
        defined({
          uuid: requireString(args, 'uuid'),
          parentUuid: optionalString(args, 'parentUuid'),
          parentPath: optionalString(args, 'parentPath'),
          position: optionalArray(args, 'position'),
        }),
      ]),
  },
  {
    name: 'prefab_create_from_node',
    description: 'Create a prefab asset from a node in the open scene. The source node becomes an instance: it is renamed after the prefab and its uuid changes.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: { type: 'string', description: 'Node uuid (the node to turn into a prefab).' },
        path: { type: 'string', description: 'Node path (used when uuid is absent).' },
        url: { type: 'string', description: 'Target prefab url, e.g. db://assets/Prefabs/Enemy.prefab.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      let nodeUuid = optionalString(args, 'uuid')
      const nodePath = optionalString(args, 'path')
      if (!nodeUuid) {
        if (!nodePath) throw new ToolInputError('Provide "uuid" or "path".')
        nodeUuid = ((await ctx.bridge.scene('getNode', [{ path: nodePath }])) as { uuid: string }).uuid
      }
      // Creator's message takes (nodeUuid, url) positionally; it returns nothing useful.
      const url = requireString(args, 'url')
      await ctx.bridge.request('scene', 'create-prefab', nodeUuid, url)
      const asset = (await ctx.bridge.request('asset-db', 'query-asset-info', url)) as { uuid?: string } | null
      return {
        created: url,
        prefabUuid: asset?.uuid,
        note: 'The source node is renamed after the prefab and gets a new uuid; find it again with node_find (by name) before editing it.',
      }
    },
  },
  prefabNodeTool('prefab_apply', "Apply a prefab instance's changes back to its prefab asset.", 'apply-prefab'),
  prefabNodeTool('prefab_revert', "Discard a prefab instance's overrides and restore it from the prefab asset.", 'restore-prefab'),
  prefabNodeTool('prefab_unlink', 'Detach a node from its prefab (it becomes a plain node).', 'unlink-prefab'),
]
