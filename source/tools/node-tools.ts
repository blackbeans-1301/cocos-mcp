/**
 * Node tools — every handler calls the scene script (see `source/scene.ts`).
 * A node is identified by `uuid` (preferred) or `path` (scene-relative, e.g.
 * `Canvas/Player`).
 */
import type { ToolDef, ToolContext } from './types.js'
import { defined, optionalArray, optionalBoolean, optionalNumber, optionalString, requireString, ToolInputError } from './types.js'

const VEC3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[x, y, z]' }

const ref = (args: Record<string, unknown>): Record<string, unknown> =>
  defined({ uuid: optionalString(args, 'uuid'), path: optionalString(args, 'path') })

const call = (ctx: ToolContext, method: string, arg: Record<string, unknown>): Promise<unknown> =>
  ctx.bridge.scene(method, [arg])

const REF_PROPS = {
  uuid: { type: 'string', description: 'Node uuid.' },
  path: { type: 'string', description: 'Scene-relative node path, e.g. Canvas/Player.' },
} as const

export const nodeTools: ToolDef[] = [
  {
    name: 'node_tree',
    description: 'Read the scene hierarchy as a tree (name, path, transform, components).',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', description: 'How deep to descend (default 6).' },
        includeComponents: { type: 'boolean', description: 'Include component class names (default true).' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      call(ctx, 'nodeTree', defined({ maxDepth: optionalNumber(args, 'maxDepth'), includeComponents: optionalBoolean(args, 'includeComponents') })),
  },
  {
    name: 'node_get',
    description: 'Read one node: name, path, transform, active state and components.',
    inputSchema: { type: 'object', properties: { ...REF_PROPS }, additionalProperties: false },
    handler: (args, ctx) => call(ctx, 'getNode', ref(args)),
  },
  {
    name: 'node_find',
    description: 'Find nodes by name (exact or substring) and/or by component type.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name to match (exact or substring).' },
        component: { type: 'string', description: 'Component class name, e.g. cc.Sprite.' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => call(ctx, 'findNodes', defined({ name: optionalString(args, 'name'), component: optionalString(args, 'component') })),
  },
  {
    name: 'node_create',
    description: 'Create a node under a parent (defaults to the scene root). Returns the new node.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        parentUuid: { type: 'string', description: 'Parent node uuid (default: scene root).' },
        parentPath: { type: 'string', description: 'Parent node path (used when parentUuid is absent).' },
        position: VEC3,
        rotation: { ...VEC3, description: '[x, y, z] euler angles in degrees' },
        scale: VEC3,
        components: { type: 'array', items: { type: 'string' }, description: 'Component class names to add.' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      call(
        ctx,
        'createNode',
        defined({
          name: optionalString(args, 'name'),
          parentUuid: optionalString(args, 'parentUuid'),
          parentPath: optionalString(args, 'parentPath'),
          position: optionalArray(args, 'position'),
          rotation: optionalArray(args, 'rotation'),
          scale: optionalArray(args, 'scale'),
          components: optionalArray(args, 'components'),
        }),
      ),
  },
  {
    name: 'node_delete',
    description: 'Delete a node (the scene root cannot be deleted).',
    inputSchema: { type: 'object', properties: { ...REF_PROPS }, additionalProperties: false },
    handler: (args, ctx) => call(ctx, 'deleteNode', ref(args)),
  },
  {
    name: 'node_duplicate',
    description: 'Duplicate a node (clone kept at the same parent).',
    inputSchema: {
      type: 'object',
      properties: { ...REF_PROPS, name: { type: 'string', description: 'Name for the clone.' } },
      additionalProperties: false,
    },
    handler: (args, ctx) => call(ctx, 'duplicateNode', defined({ ...ref(args), name: optionalString(args, 'name') })),
  },
  {
    name: 'node_rename',
    description: 'Rename a node.',
    inputSchema: {
      type: 'object',
      properties: { ...REF_PROPS, name: { type: 'string', description: 'New name.' } },
      required: ['name'],
      additionalProperties: false,
    },
    handler: (args, ctx) => call(ctx, 'renameNode', { ...ref(args), name: requireString(args, 'name') }),
  },
  {
    name: 'node_set_transform',
    description: 'Set a node position/rotation(euler, deg)/scale, active state or layer.',
    inputSchema: {
      type: 'object',
      properties: {
        ...REF_PROPS,
        position: VEC3,
        rotation: { ...VEC3, description: '[x, y, z] euler angles in degrees' },
        scale: VEC3,
        active: { type: 'boolean' },
        layer: { type: 'number' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      call(
        ctx,
        'setNodeTransform',
        defined({
          ...ref(args),
          position: optionalArray(args, 'position'),
          rotation: optionalArray(args, 'rotation'),
          scale: optionalArray(args, 'scale'),
          active: optionalBoolean(args, 'active'),
          layer: optionalNumber(args, 'layer'),
        }),
      ),
  },
  {
    name: 'node_set_parent',
    description: 'Reparent a node (defaults to the scene root).',
    inputSchema: {
      type: 'object',
      properties: {
        ...REF_PROPS,
        parentUuid: { type: 'string' },
        parentPath: { type: 'string' },
        keepWorldTransform: { type: 'boolean', description: 'Preserve world transform (default false).' },
      },
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      call(
        ctx,
        'setNodeParent',
        defined({
          ...ref(args),
          parentUuid: optionalString(args, 'parentUuid'),
          parentPath: optionalString(args, 'parentPath'),
          keepWorldTransform: optionalBoolean(args, 'keepWorldTransform'),
        }),
      ),
  },
  {
    name: 'node_set_sibling_index',
    description: 'Move a node to a position among its siblings (render/layout order).',
    inputSchema: {
      type: 'object',
      properties: { ...REF_PROPS, index: { type: 'number', description: 'Target index; large values go last.' } },
      required: ['index'],
      additionalProperties: false,
    },
    handler: (args, ctx) => call(ctx, 'setSiblingIndex', { ...ref(args), index: optionalNumber(args, 'index') }),
  },
  {
    name: 'node_create_tree',
    description:
      'Create a whole subtree in one call. `tree` is {name, position, rotation, scale, active, components: [classNames], children: [same shape]}. Created under a parent (default: scene root).',
    inputSchema: {
      type: 'object',
      properties: {
        tree: { type: 'object', description: 'Root spec of the subtree.' },
        parentUuid: { type: 'string' },
        parentPath: { type: 'string' },
      },
      required: ['tree'],
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      call(ctx, 'createNodeTree', defined({ tree: args['tree'], parentUuid: optionalString(args, 'parentUuid'), parentPath: optionalString(args, 'parentPath') })),
  },
  {
    name: 'node_set_property',
    description: 'Set any property on a node (e.g. layer, name) to a JSON value. Object references: {"$asset": uuid|db://url} (sub-assets like a SpriteFrame are "<imageUuid>@f9941"), {"$node": uuid|path}, {"$component": {"node": uuid|path, "type": "cc.Sprite"}} — also inside arrays.',
    inputSchema: {
      type: 'object',
      properties: { ...REF_PROPS, property: { type: 'string' }, value: { description: 'JSON value.' } },
      required: ['property', 'value'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      if (!('value' in args)) throw new ToolInputError('Provide "value".')
      return call(ctx, 'setNodeProperty', { ...ref(args), property: requireString(args, 'property'), value: args['value'] })
    },
  },
]
