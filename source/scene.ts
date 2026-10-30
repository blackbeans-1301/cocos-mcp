/**
 * Cocos Creator **scene script** — runs in the engine runtime, in the same
 * context as the project's own scripts, so it can call `cc.*`.
 *
 * Registered in `package.json` › `contributions.scene.script`; the editor invokes
 * these methods through `Editor.Message.request('scene', 'execute-scene-script',
 * { name, method, args })` (see `bridge.ts`).
 *
 * Why almost every scene/node/component tool goes through here instead of the
 * editor's `scene:*` messages: this file is the *only* place that depends on
 * engine API shapes, and it is one file to fix when a Creator build behaves
 * differently. The editor's `scene:*` message names differ across versions; `cc`
 * does not.
 *
 * Everything returned must be JSON-serializable — nodes/components are converted
 * to plain objects before they cross the IPC boundary.
 */

declare const Editor: { App: { path: string }; Message: { request(pkg: string, message: string, ...args: unknown[]): Promise<unknown> } }
declare const module: { paths: string[] }

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

// The engine resolves `require('cc')` from the editor's node_modules (official 3.8 pattern).
module.paths.push(`${Editor.App.path}/node_modules`)

let engine: Any = null
const cc = (): Any => {
  if (!engine) engine = require('cc')
  return engine
}

const ok = (value?: unknown): { ok: true; value?: unknown } =>
  value === undefined ? { ok: true } : { ok: true, value }

const fail = (message: string): never => {
  throw new Error(message)
}

// ---------------------------------------------------------------------------
// Node lookup helpers
// ---------------------------------------------------------------------------

const scene = (): Any => {
  const s = cc().director.getScene()
  if (!s) fail('No scene is open in the editor.')
  return s
}

/** Editor-internal nodes (gizmo/foreground/background layers) are not part of the user's scene. */
const isEditorInternal = (node: Any): boolean => {
  const hidden = (cc().CCObject ?? cc().Object)?.Flags?.HideInHierarchy ?? 0
  return (hidden !== 0 && (node.objFlags & hidden) !== 0) || /^Editor Scene /.test(node.name)
}

const visibleChildren = (node: Any): Any[] => (node.children as Any[]).filter((child) => !isEditorInternal(child))

const walk = (node: Any, visit: (n: Any) => boolean): Any => {
  if (visit(node)) return node
  for (const child of visibleChildren(node)) {
    const found = walk(child, visit)
    if (found) return found
  }
  return null
}

const uuidOf = (node: Any): string => node.uuid ?? node._id ?? ''

/** Scene-relative path, e.g. `Canvas/Player` (the scene root itself is excluded). */
const pathOf = (node: Any): string => {
  const parts: string[] = []
  let current: Any = node
  const root = scene()
  while (current && current !== root) {
    parts.unshift(current.name)
    current = current.parent
  }
  return parts.join('/')
}

const resolveNode = (arg: { uuid?: string; path?: string }): Any => {
  const root = scene()
  if (arg.uuid) {
    const found = walk(root, (n) => uuidOf(n) === arg.uuid)
    if (!found) fail(`No node with uuid "${arg.uuid}" in the open scene.`)
    return found
  }
  if (arg.path) {
    const byPath = cc().find(arg.path, root)
    if (byPath) return byPath
    const name = arg.path.split('/').filter(Boolean).pop()
    const byName = walk(root, (n) => n.name === name)
    if (byName) return byName
    fail(`No node at path "${arg.path}" in the open scene.`)
  }
  fail('Provide "uuid" or "path" to identify the node.')
}

/** The parent named by `parentUuid`/`parentPath`, or the scene root when neither is given. */
const resolveParent = (options: Any): Any =>
  options.parentUuid || options.parentPath ? resolveNode({ uuid: options.parentUuid, path: options.parentPath }) : scene()

/** Load an asset by uuid or db:// url (sub-assets like `<uuid>@f9941` are plain uuids). */
const loadAsset = async (ref: string): Promise<Any> => {
  const uuid = ref.startsWith('db://') ? ((await Editor.Message.request('asset-db', 'query-uuid', ref)) as string) : ref
  if (!uuid) fail(`No asset found for "${ref}".`)
  // Ask the asset db first: a bad uuid otherwise surfaces as an opaque "download failed: import://…".
  const info = await Editor.Message.request('asset-db', 'query-asset-info', uuid).catch(() => null)
  if (!info) fail(`No asset found for "${ref}" (sub-assets look like "<imageUuid>@f9941").`)
  return new Promise((resolve, reject) => {
    cc().assetManager.loadAny({ uuid }, (err: Error | null, asset: Any) => (err ? reject(err) : resolve(asset)))
  })
}

const refNode = (ref: string): Any => {
  try {
    return resolveNode({ uuid: ref })
  } catch {
    return resolveNode({ path: ref })
  }
}

const isRef = (value: Any): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value) && ('$asset' in value || '$node' in value || '$component' in value)

/**
 * JSON can't carry engine objects, so a property value may name one:
 * `{"$asset": uuid|db://url}`, `{"$node": uuid|path}`, `{"$component": {"node": uuid|path, "type": "cc.Sprite"}}`.
 * Resolved recursively through arrays and plain objects; `{"$asset": ""}` (an empty slot in a dump) is null.
 */
const resolveRefs = async (value: Any): Promise<Any> => {
  if (Array.isArray(value)) return Promise.all(value.map(resolveRefs))
  if (value && typeof value === 'object') {
    if (typeof value.$asset === 'string') return value.$asset === '' ? null : loadAsset(value.$asset)
    if (typeof value.$node === 'string') return value.$node === '' ? null : refNode(value.$node)
    if (value.$component && typeof value.$component === 'object') {
      return findComponent(refNode(String(value.$component.node)), value.$component.type, value.$component.index)
    }
    if (Object.getPrototypeOf(value) === Object.prototype) {
      const out: Record<string, unknown> = {}
      for (const [key, inner] of Object.entries(value)) out[key] = await resolveRefs(inner)
      return out
    }
  }
  return value
}

/** The engine's attribute record for `owner[key]` (`@property(Foo)` / `@property([Foo])` put the class in `ctor`). */
const declaredAttr = (owner: Any, key: string): Any => {
  const klass = owner?.constructor
  if (!Array.isArray(klass?.__props__)) return undefined
  try {
    return cc().CCClass.attr(klass, key)
  } catch {
    return undefined
  }
}

/** A plain `@ccclass` data class (not an asset, node, component or value type) — built field by field. */
const isDataClass = (Ctor: Any): boolean => {
  const C = cc()
  if (typeof Ctor !== 'function' || !Array.isArray(Ctor.__props__)) return false
  return ![C.Asset, C.Node, C.Component, C.ValueType].some((Base: Any) => Base && (Ctor === Base || Ctor.prototype instanceof Base))
}

const isStringAttr = (attr: Any): boolean => attr?.type === 'String' || attr?.type?.name === 'String'

/**
 * Some MCP clients send an untyped `value` as its JSON text (`"null"`, `"[1,2]"`). For a property that is not a
 * string, read such text as JSON so `null` clears a reference instead of storing the word "null".
 */
const looseJson = (value: Any, attr: Any, current: Any): Any => {
  if (typeof value !== 'string' || typeof current === 'string' || isStringAttr(attr)) return value
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' ? value : parsed
  } catch {
    return value
  }
}

/** A fresh instance of a data class holding `value`'s fields on top of `current`'s (so omitted fields are kept). */
const buildData = async (Ctor: Any, current: Any, value: Any, label: string): Promise<Any> => {
  const C = cc()
  if (value === null || value === undefined || value instanceof Ctor) return value ?? null
  if (typeof value !== 'object' || Array.isArray(value) || isRef(value)) {
    fail(`${label} expects an object of class ${C.js.getClassName(Ctor)}, got ${JSON.stringify(value)}.`)
  }
  const target = new Ctor()
  if (current instanceof Ctor) for (const key of Ctor.__props__ as string[]) target[key] = current[key]
  for (const [key, inner] of Object.entries(value)) {
    assertProperty(target, key, `${label} (${C.js.getClassName(Ctor)})`)
    target[key] = await toEngine(target, key, inner, `${label}.${key}`)
  }
  return target
}

/**
 * Build the engine value for `owner[key]` from JSON. `@ccclass` data objects — and arrays of them — are created with
 * their declared class and filled field by field, so asset/node references inside them resolve too. `elementCtor`
 * is the declared element class when `owner` is itself an array.
 */
const toEngine = async (owner: Any, key: string, value: Any, label: string, elementCtor?: Any): Promise<Any> => {
  const current = owner[key]
  const attr = Array.isArray(owner) ? { ctor: elementCtor } : declaredAttr(owner, key)
  const input = looseJson(value, attr, current)
  const Ctor = isDataClass(attr?.ctor) ? attr.ctor : !Array.isArray(current) && isDataClass(current?.constructor) ? current.constructor : undefined
  if (!Ctor) return coerce(current, await resolveRefs(input))
  if (Array.isArray(current)) {
    if (!Array.isArray(input)) fail(`${label} is an array of ${cc().js.getClassName(Ctor)}; pass an array (or set one element with "${label.split(' › ').pop()}.<index>").`)
    return Promise.all(input.map((item: Any, i: number) => buildData(Ctor, current[i], item, `${label}[${i}]`)))
  }
  return buildData(Ctor, current, input, label)
}

/**
 * Walk a dotted property path (`skins.1.skinName`) to the object that holds its last segment. `elementCtor` is the
 * declared element class when that holder is an array.
 */
const walkPath = (root: Any, property: string, label: string): { owner: Any; key: string; elementCtor?: Any } => {
  const parts = property.split('.')
  let owner: Any = root
  let elementCtor: Any
  const step = (part: string, at: string): string => {
    if (Array.isArray(owner)) {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0) fail(`"${at}": "${part}" is not an array index.`)
      return part
    }
    assertProperty(owner, part, `${label}${at === part ? '' : ` › ${at}`}`)
    return part
  }
  for (let i = 0; i < parts.length - 1; i++) {
    const at = parts.slice(0, i + 1).join('.')
    const part = step(parts[i] as string, at)
    elementCtor = Array.isArray(owner) ? undefined : declaredAttr(owner, part)?.ctor
    owner = owner[part]
    if (owner === null || typeof owner !== 'object') fail(`"${at}" is ${owner === null ? 'null' : typeof owner}; cannot read "${parts[i + 1]}" from it.`)
  }
  const key = step(parts[parts.length - 1] as string, property)
  if (Array.isArray(owner) && Number(key) > owner.length) fail(`"${property}": index ${key} is past the end (length ${owner.length}).`)
  return { owner, key, ...(Array.isArray(owner) ? { elementCtor } : {}) }
}

/** Create a node (and, recursively, its `children`) from a plain spec. */
const buildNode = (spec: Any, parent: Any): Any => {
  const C = cc()
  const node = new C.Node(spec.name || 'New Node')
  parent.addChild(node)
  if (spec.position) node.setPosition(vec(spec.position, C.Vec3))
  if (spec.rotation) node.setRotationFromEuler(vec(spec.rotation, C.Vec3))
  if (spec.scale) node.setScale(vec(spec.scale, C.Vec3))
  if (typeof spec.active === 'boolean') node.active = spec.active
  // Like the editor's own "Create Node": a child takes its parent's layer (UI_2D under a Canvas) unless told otherwise.
  if (typeof spec.layer === 'number') node.layer = spec.layer
  else if (parent !== scene()) node.layer = parent.layer
  for (const type of (spec.components as string[] | undefined) ?? []) {
    if (!addComponentTo(node, type)) fail(`Unknown component type "${type}".`)
  }
  for (const child of (spec.children as Any[] | undefined) ?? []) buildNode(child, node)
  return node
}

const vec = (value: Any, Ctor: Any): Any => {
  if (value === undefined || value === null) return undefined
  if (value instanceof Ctor) return value
  if (Array.isArray(value)) return new Ctor(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0)
  if (typeof value === 'object') return new Ctor(value.x ?? 0, value.y ?? 0, value.z ?? 0)
  fail(`Cannot build ${Ctor.name} from ${JSON.stringify(value)}.`)
}

/**
 * Build the right engine value for `target[property]` from a plain JSON value. An object that names only some
 * components (`{"x": 5}`) keeps the others from the current value.
 */
const coerce = (current: Any, value: Any): Any => {
  const C = cc()
  if (value === null || value === undefined) return value
  if (current instanceof C.Vec3) {
    if (value instanceof C.Vec3 || Array.isArray(value)) return vec(value, C.Vec3)
    return new C.Vec3(value?.x ?? current.x, value?.y ?? current.y, value?.z ?? current.z)
  }
  if (current instanceof C.Vec2) {
    if (Array.isArray(value)) return new C.Vec2(value[0] ?? 0, value[1] ?? 0)
    return new C.Vec2(value?.x ?? current.x, value?.y ?? current.y)
  }
  if (current instanceof C.Quat) {
    const src = Array.isArray(value) ? { x: value[0], y: value[1], z: value[2], w: value[3] } : value ?? {}
    return new C.Quat(src.x ?? 0, src.y ?? 0, src.z ?? 0, src.w ?? 1)
  }
  if (current instanceof C.Color) {
    if (typeof value === 'string') return new C.Color().fromHEX(value)
    if (Array.isArray(value)) return new C.Color(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 255)
    return new C.Color(value?.r ?? current.r, value?.g ?? current.g, value?.b ?? current.b, value?.a ?? current.a)
  }
  if (current instanceof C.Size) {
    if (Array.isArray(value)) return new C.Size(value[0] ?? 0, value[1] ?? 0)
    return new C.Size(value?.width ?? current.width, value?.height ?? current.height)
  }
  return value
}

const componentTypes = (node: Any): string[] =>
  node.components.map((component: Any) => cc().js.getClassName(component)).filter(Boolean) as string[]

const nodeDump = (node: Any, includeComponents = true): Record<string, unknown> => ({
  uuid: uuidOf(node),
  name: node.name,
  path: pathOf(node),
  active: node.active,
  activeInHierarchy: node.activeInHierarchy,
  layer: node.layer,
  position: { x: node.position.x, y: node.position.y, z: node.position.z },
  rotation: { x: node.eulerAngles.x, y: node.eulerAngles.y, z: node.eulerAngles.z },
  scale: { x: node.scale.x, y: node.scale.y, z: node.scale.z },
  childCount: visibleChildren(node).length,
  ...(includeComponents ? { components: componentTypes(node) } : {}),
})

const tree = (node: Any, depth: number, maxDepth: number, includeComponents: boolean): Record<string, unknown> => {
  const out = nodeDump(node, includeComponents) as Record<string, unknown>
  out['children'] =
    depth >= maxDepth ? [] : visibleChildren(node).map((child) => tree(child, depth + 1, maxDepth, includeComponents))
  return out
}

const findComponent = (node: Any, type: string, index: number | undefined): Any => {
  const matches = node.components.filter((component: Any) => cc().js.getClassName(component) === type)
  const chosen = index === undefined ? matches[0] : matches[index]
  if (!chosen) fail(`Node "${node.name}" has no component of type "${type}"${index === undefined ? '' : ` at index ${index}`}.`)
  return chosen
}

/** Declared (serialized) property names — `__props__` also lists ones still `undefined` on the instance. */
const declaredProps = (target: Any): string[] => (target?.constructor?.__props__ as string[] | undefined) ?? []

/**
 * Refuse a property the target does not have: assigning an unknown name would silently create it
 * and a typo would "succeed". The hint lists close matches so the caller can correct itself.
 */
const assertProperty = (target: Any, property: string, label: string, hint = 'Use component_dump to list its properties.'): void => {
  if (property in target || declaredProps(target).includes(property)) return
  const needle = property.toLowerCase()
  const close = declaredProps(target)
    .filter((name) => !name.startsWith('_') && (name.toLowerCase().includes(needle) || needle.includes(name.toLowerCase())))
    .slice(0, 8)
  fail(`${label} has no property "${property}".${close.length ? ` Did you mean: ${close.join(', ')}?` : ` ${hint}`}`)
}

// ---------------------------------------------------------------------------
// Methods callable from the editor
// ---------------------------------------------------------------------------

export function load(): void {}
export function unload(): void {}

export const methods = {
  sceneInfo() {
    const s = scene()
    return { name: s.name, uuid: uuidOf(s), childCount: visibleChildren(s).length }
  },

  nodeTree(args: Any[] = []) {
    const [options = {}] = args
    const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 6
    const includeComponents = options.includeComponents !== false
    const root = options.uuid || options.path ? resolveNode(options) : scene()
    return tree(root, 0, maxDepth, includeComponents)
  },

  findNodes(args: Any[] = []) {
    const [query = {}] = args
    const matches: Record<string, unknown>[] = []
    walk(scene(), (node) => {
      const nameHit = !query.name || node.name === query.name || node.name.includes(query.name)
      const typeHit = !query.component || componentTypes(node).includes(query.component)
      if (nameHit && typeHit) matches.push(nodeDump(node))
      return false
    })
    return matches
  },

  getNode(args: Any[] = []) {
    return nodeDump(resolveNode(args[0] ?? {}))
  },

  createNode(args: Any[] = []) {
    const [options = {}] = args
    return nodeDump(buildNode(options, resolveParent(options)))
  },

  /** Create a whole subtree in one call: `{name, components, position, children: [...]}` under a parent. */
  createNodeTree(args: Any[] = []) {
    const [options = {}] = args
    if (!options.tree || typeof options.tree !== 'object') fail('Provide "tree".')
    return tree(buildNode(options.tree, resolveParent(options)), 0, 99, true)
  },

  /** Prefab link of a node: the prefab asset and the root of the instance it belongs to. */
  getPrefabInfo(args: Any[] = []) {
    const node = resolveNode(args[0] ?? {})
    const link = node._prefab
    if (!link?.asset) fail(`Node "${node.name}" is not part of a prefab instance.`)
    return { assetUuid: link.asset._uuid || link.asset.uuid, rootUuid: uuidOf(link.root ?? node) }
  },

  setSiblingIndex(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    if (typeof options.index !== 'number') fail('Provide a numeric "index".')
    node.setSiblingIndex(options.index)
    return nodeDump(node)
  },

  deleteNode(args: Any[] = []) {
    const node = resolveNode(args[0] ?? {})
    if (node === scene()) fail('Refusing to delete the scene root.')
    const name = node.name
    node.destroy()
    return ok({ deleted: name })
  },

  duplicateNode(args: Any[] = []) {
    const [options = {}] = args
    const C = cc()
    const source = resolveNode(options)
    const clone = C.instantiate(source)
    clone.parent = source.parent
    if (options.name) clone.name = options.name
    return nodeDump(clone)
  },

  renameNode(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    if (typeof options.name !== 'string' || options.name === '') fail('Provide "name".')
    node.name = options.name
    return nodeDump(node)
  },

  setNodeTransform(args: Any[] = []) {
    const [options = {}] = args
    const C = cc()
    const node = resolveNode(options)
    if (options.position) node.setPosition(vec(options.position, C.Vec3))
    if (options.rotation) node.setRotationFromEuler(vec(options.rotation, C.Vec3))
    if (options.scale) node.setScale(vec(options.scale, C.Vec3))
    if (typeof options.active === 'boolean') node.active = options.active
    if (typeof options.layer === 'number') node.layer = options.layer
    return nodeDump(node)
  },

  setNodeParent(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    const parent = resolveParent(options)
    if (node === scene()) fail('Cannot reparent the scene root.')
    for (let up: Any = parent; up; up = up.parent) {
      if (up === node) fail('Cannot make a node a child of itself or of its own descendant.')
    }
    node.setParent(parent, options.keepWorldTransform === true)
    return nodeDump(node)
  },

  async setNodeProperty(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    if (typeof options.property !== 'string') fail('Provide "property".')
    assertProperty(node, options.property, `Node "${node.name}"`, 'Node properties are name, active, layer, mobility, … — see node_get; component properties are set with component_set_property.')
    node[options.property] = coerce(node[options.property], await resolveRefs(looseJson(options.value, undefined, node[options.property])))
    return nodeDump(node)
  },

  listComponents(args: Any[] = []) {
    const node = resolveNode(args[0] ?? {})
    return node.components.map((component: Any) => ({
      type: cc().js.getClassName(component),
      enabled: component.enabled !== false,
    }))
  },

  addComponent(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    if (typeof options.type !== 'string') fail('Provide "type".')
    if (!addComponentTo(node, options.type)) fail(`Unknown component type "${options.type}".`)
    return nodeDump(node)
  },

  removeComponent(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    const component = findComponent(node, options.type, options.index)
    component.destroy()
    // destroy() is deferred to the end of the frame, so `node.components` still lists it — drop it from the reply.
    const dump = nodeDump(node)
    const remaining = node.components.filter((c: Any) => c !== component)
    return { ...dump, components: remaining.map((c: Any) => cc().js.getClassName(c)).filter(Boolean) }
  },

  getComponentProperty(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    const component = findComponent(node, options.type, options.index)
    if (typeof options.property !== 'string') fail('Provide "property".')
    const { owner, key } = walkPath(component, options.property, `Component "${options.type}"`)
    return { type: options.type, property: options.property, value: plain(owner[key]) }
  },

  /** `property` may be a dotted path into nested data (`skins.1.skinName`); arrays are indexed by number. */
  async setComponentProperty(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    const component = findComponent(node, options.type, options.index)
    if (typeof options.property !== 'string') fail('Provide "property".')
    const label = `Component "${options.type}"`
    const { owner, key, elementCtor } = walkPath(component, options.property, label)
    owner[key] = await toEngine(owner, key, options.value, `${label} › ${options.property}`, elementCtor)
    return { type: options.type, property: options.property, value: plain(owner[key]) }
  },

  async callComponentMethod(args: Any[] = []) {
    const [options = {}] = args
    const node = resolveNode(options)
    const component = findComponent(node, options.type, options.index)
    const fn = component[options.method]
    if (typeof fn !== 'function') fail(`Component "${options.type}" has no method "${options.method}".`)
    const result = await fn.apply(component, options.args ?? [])
    return { result: plain(result) }
  },

  listComponentTypes() {
    const C = cc()
    const names = new Set<string>()
    // `cc.*` exports plus every registered class — project scripts (`@ccclass`) and modules like `sp.Skeleton`.
    const registry = (C.js._nameToClass ?? {}) as Record<string, Any>
    for (const value of [...(Object.values(C) as Any[]), ...Object.values(registry)]) {
      if (typeof value === 'function' && value.prototype instanceof C.Component) {
        const name = C.js.getClassName(value)
        if (name) names.add(name)
      }
    }
    return [...names].sort()
  },

  async instantiatePrefab(args: Any[] = []) {
    const [options = {}] = args
    if (typeof options.uuid !== 'string') fail('Provide the prefab asset "uuid".')
    const C = cc()
    const prefab: Any = await loadAsset(options.uuid)
    const node = C.instantiate(prefab)
    const parent = resolveParent(options)
    parent.addChild(node)
    if (options.position) node.setPosition(vec(options.position, C.Vec3))
    return nodeDump(node)
  },

  /** Escape hatch: evaluate JavaScript in the engine runtime with `cc` in scope. */
  async evalScript(args: Any[] = []) {
    const [options = {}] = args
    if (typeof options.code !== 'string') fail('Provide "code".')
    // eslint-disable-next-line no-new-func
    const fn = new Function('cc', 'args', `"use strict"; return (async () => { ${options.code}\n })();`)
    return plain(await fn(cc(), options.args ?? null))
  },
}

/** Register a component class by name (`cc.js.getClassByName`). */
const addComponentTo = (node: Any, type: string): boolean => {
  const C = cc()
  const klass = C.js.getClassByName(type)
  if (typeof klass !== 'function') return false
  node.addComponent(klass)
  return true
}

/** Convert an engine value to JSON-safe data (Vec3/Color/… → plain objects). */
const plain = (value: Any, depth = 0): Any => {
  const C = cc()
  if (value === null || value === undefined) return value
  if (value instanceof C.Vec3) return { x: value.x, y: value.y, z: value.z }
  if (value instanceof C.Vec2) return { x: value.x, y: value.y }
  if (value instanceof C.Quat) return { x: value.x, y: value.y, z: value.z, w: value.w }
  if (value instanceof C.Color) return { r: value.r, g: value.g, b: value.b, a: value.a }
  if (value instanceof C.Size) return { width: value.width, height: value.height }
  // Engine objects link to each other (SpriteFrame -> Texture2D -> ...), so they are returned as references, never walked.
  if (value instanceof C.Node) return nodeDump(value, false)
  if (value instanceof C.Component) {
    return { $component: { node: uuidOf(value.node), type: C.js.getClassName(value) } }
  }
  if (value instanceof C.Asset) return { $asset: value._uuid || value.uuid, name: value.name, type: C.js.getClassName(value) }
  if (depth > 6) return String(value)
  if (Array.isArray(value)) return value.map((inner) => plain(inner, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) out[key] = plain(inner, depth + 1)
    return out
  }
  return value
}
