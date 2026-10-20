/**
 * Component tools — call the scene script. A component is addressed by its node
 * (`uuid`/`path`) plus its class name (`type`); `index` picks among several
 * components of the same class on one node.
 */
import type { ToolDef, ToolContext } from './types.js'
import { defined, optionalArray, optionalNumber, optionalString, requireString, ToolInputError } from './types.js'

const ref = (args: Record<string, unknown>): Record<string, unknown> =>
  defined({
    uuid: optionalString(args, 'uuid'),
    path: optionalString(args, 'path'),
    type: optionalString(args, 'type'),
    index: optionalNumber(args, 'index'),
  })

const call = (ctx: ToolContext, method: string, arg: Record<string, unknown>): Promise<unknown> =>
  ctx.bridge.scene(method, [arg])

const TARGET = {
  uuid: { type: 'string', description: 'Node uuid.' },
  path: { type: 'string', description: 'Scene-relative node path.' },
  type: { type: 'string', description: 'Component class name, e.g. cc.Sprite.' },
  index: { type: 'number', description: 'Index among components of the same type (default 0).' },
} as const

type Json = Record<string, unknown>
const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** One value from the editor's component dump, in the same JSON shape component_set_property accepts. */
const dumpValue = (entry: Json): unknown => {
  const value = entry['value']
  const extendsList = Array.isArray(entry['extends']) ? (entry['extends'] as string[]) : []
  if (isJson(value) && typeof value['uuid'] === 'string') {
    if (entry['type'] === 'cc.Node') return { $node: value['uuid'] }
    if (extendsList.includes('cc.Asset')) return { $asset: value['uuid'] }
    if (extendsList.includes('cc.Component')) return { $component: { node: value['uuid'], type: entry['type'] } }
  }
  return value ?? null
}

/** Flatten one property of the editor's `query-component` dump (arrays hold one such entry per element). */
export const dumpProperty = (name: string, entry: Json): Json => {
  const isArray = entry['isArray'] === true && Array.isArray(entry['value'])
  const enumList = Array.isArray(entry['enumList']) ? (entry['enumList'] as Json[]) : []
  return {
    name,
    type: entry['type'],
    // Array elements carry their own `value`/`type` but not `extends`; they inherit it from the property.
    value: isArray
      ? (entry['value'] as unknown[]).map((element) => dumpValue({ type: entry['type'], extends: entry['extends'], ...(isJson(element) ? element : { value: element }) }))
      : dumpValue(entry),
    ...(isArray ? { array: true } : {}),
    ...(entry['readonly'] === true ? { readonly: true } : {}),
    ...(enumList.length ? { enum: enumList.slice(0, 40).map((item) => ({ name: item['name'], value: item['value'] })) } : {}),
    ...(typeof entry['tooltip'] === 'string' && entry['tooltip'] ? { tooltip: entry['tooltip'] } : {}),
  }
}

export const componentTools: ToolDef[] = [
  {
    name: 'component_dump',
    description:
      'List every editable property of a component with its type, current value (in the form component_set_property accepts), enum choices and read-only flag. Use it to learn property names before setting them.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET, all: { type: 'boolean', description: 'Also list hidden/internal properties (default false).' } },
      required: ['type'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const type = requireString(args, 'type')
      const node = (await call(ctx, 'getNode', defined({ uuid: optionalString(args, 'uuid'), path: optionalString(args, 'path') }))) as { uuid: string; path: string }
      const dump = (await ctx.bridge.request('scene', 'query-node', node.uuid)) as { __comps__?: Json[] } | null
      const matches = (dump?.__comps__ ?? []).filter((comp) => comp['type'] === type)
      const index = optionalNumber(args, 'index') ?? 0
      const chosen = matches[index]
      if (!chosen) throw new Error(`Node "${node.path}" has no component of type "${type}"${index ? ` at index ${index}` : ''}.`)
      const uuid = ((chosen['value'] as Json | undefined)?.['uuid'] as Json | undefined)?.['value']
      const component = (await ctx.bridge.request('scene', 'query-component', uuid)) as { value?: Record<string, Json> } | null
      const all = args['all'] === true
      const properties = Object.entries(component?.value ?? {})
        .filter(([name, entry]) => isJson(entry) && (all || (entry['visible'] !== false && !name.startsWith('_'))))
        .map(([name, entry]) => dumpProperty(name, entry))
      const enabled = (((chosen['value'] as Json | undefined)?.['enabled'] as Json | undefined)?.['value'] ?? true) as boolean
      return { node: node.path, type, index, enabled, properties }
    },
  },
  {
    name: 'component_list',
    description: 'List the components on a node (class name + enabled).',
    inputSchema: {
      type: 'object',
      properties: { uuid: TARGET.uuid, path: TARGET.path },
      additionalProperties: false,
    },
    handler: (args, ctx) => call(ctx, 'listComponents', defined({ uuid: optionalString(args, 'uuid'), path: optionalString(args, 'path') })),
  },
  {
    name: 'component_add',
    description: 'Add a component to a node by class name.',
    inputSchema: {
      type: 'object',
      properties: { uuid: TARGET.uuid, path: TARGET.path, type: { ...TARGET.type } },
      required: ['type'],
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      call(ctx, 'addComponent', defined({ uuid: optionalString(args, 'uuid'), path: optionalString(args, 'path'), type: requireString(args, 'type') })),
  },
  {
    name: 'component_remove',
    description: 'Remove a component from a node.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET },
      required: ['type'],
      additionalProperties: false,
    },
    handler: (args, ctx) => call(ctx, 'removeComponent', { ...ref(args), type: requireString(args, 'type') }),
  },
  {
    name: 'component_get_property',
    description: 'Read one property of a component.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET, property: { type: 'string' } },
      required: ['type', 'property'],
      additionalProperties: false,
    },
    handler: (args, ctx) => call(ctx, 'getComponentProperty', { ...ref(args), property: requireString(args, 'property') }),
  },
  {
    name: 'component_set_properties',
    description:
      'Set several properties of one component in a single call (same value forms as component_set_property). Stops at the first bad property and reports which ones were applied.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET, properties: { type: 'object', description: 'Map of property name to value.' } },
      required: ['type', 'properties'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const properties = args['properties']
      if (!isJson(properties) || Object.keys(properties).length === 0) throw new ToolInputError('"properties" must be a non-empty object.')
      const applied: string[] = []
      for (const [property, value] of Object.entries(properties)) {
        try {
          await call(ctx, 'setComponentProperty', { ...ref(args), property, value })
          applied.push(property)
        } catch (err) {
          throw new Error(`Failed on "${property}": ${err instanceof Error ? err.message : String(err)} (applied before it: ${applied.join(', ') || 'none'})`)
        }
      }
      return { ok: true, applied }
    },
  },
  {
    name: 'component_set_property',
    description:
      'Set one property of a component. Engine value types are built from JSON: Vec3/Vec2/Quat from [x,y,z]/… or {x,y,z}; Color from "#rrggbb" or [r,g,b,a]; Size from [w,h]. Object references: {\"$asset\": uuid|db://url} (sub-assets like a SpriteFrame are \"<imageUuid>@f9941\"), {\"$node\": uuid|path}, {\"$component\": {\"node\": uuid|path, \"type\": \"cc.Sprite\"}} — also inside arrays.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET, property: { type: 'string' }, value: { description: 'JSON value.' } },
      required: ['type', 'property', 'value'],
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const value = args['value']
      return call(ctx, 'setComponentProperty', { ...ref(args), property: requireString(args, 'property'), value })
    },
  },
  {
    name: 'component_call_method',
    description: 'Call a method on a component with JSON arguments.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET, method: { type: 'string' }, args: { type: 'array', items: {} } },
      required: ['type', 'method'],
      additionalProperties: false,
    },
    handler: (args, ctx) =>
      call(ctx, 'callComponentMethod', {
        ...ref(args),
        method: requireString(args, 'method'),
        args: optionalArray(args, 'args') ?? [],
      }),
  },
  {
    name: 'component_types',
    description: 'List the component class names available in the running engine.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, ctx) => call(ctx, 'listComponentTypes', {}),
  },
]
