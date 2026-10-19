"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
// The engine resolves `require('cc')` from the editor's node_modules (official 3.8 pattern).
module.paths.push(`${Editor.App.path}/node_modules`);
let engine = null;
const cc = () => {
    if (!engine)
        engine = require('cc');
    return engine;
};
const ok = (value) => value === undefined ? { ok: true } : { ok: true, value };
const fail = (message) => {
    throw new Error(message);
};
// ---------------------------------------------------------------------------
// Node lookup helpers
// ---------------------------------------------------------------------------
const scene = () => {
    const s = cc().director.getScene();
    if (!s)
        fail('No scene is open in the editor.');
    return s;
};
/** Editor-internal nodes (gizmo/foreground/background layers) are not part of the user's scene. */
const isEditorInternal = (node) => {
    const hidden = (cc().CCObject ?? cc().Object)?.Flags?.HideInHierarchy ?? 0;
    return (hidden !== 0 && (node.objFlags & hidden) !== 0) || /^Editor Scene /.test(node.name);
};
const visibleChildren = (node) => node.children.filter((child) => !isEditorInternal(child));
const walk = (node, visit) => {
    if (visit(node))
        return node;
    for (const child of visibleChildren(node)) {
        const found = walk(child, visit);
        if (found)
            return found;
    }
    return null;
};
const uuidOf = (node) => node.uuid ?? node._id ?? '';
/** Scene-relative path, e.g. `Canvas/Player` (the scene root itself is excluded). */
const pathOf = (node) => {
    const parts = [];
    let current = node;
    const root = scene();
    while (current && current !== root) {
        parts.unshift(current.name);
        current = current.parent;
    }
    return parts.join('/');
};
const resolveNode = (arg) => {
    const root = scene();
    if (arg.uuid) {
        const found = walk(root, (n) => uuidOf(n) === arg.uuid);
        if (!found)
            fail(`No node with uuid "${arg.uuid}" in the open scene.`);
        return found;
    }
    if (arg.path) {
        const byPath = cc().find(arg.path, root);
        if (byPath)
            return byPath;
        const name = arg.path.split('/').filter(Boolean).pop();
        const byName = walk(root, (n) => n.name === name);
        if (byName)
            return byName;
        fail(`No node at path "${arg.path}" in the open scene.`);
    }
    fail('Provide "uuid" or "path" to identify the node.');
};
/** The parent named by `parentUuid`/`parentPath`, or the scene root when neither is given. */
const resolveParent = (options) => options.parentUuid || options.parentPath ? resolveNode({ uuid: options.parentUuid, path: options.parentPath }) : scene();
/** Load an asset by uuid or db:// url (sub-assets like `<uuid>@f9941` are plain uuids). */
const loadAsset = async (ref) => {
    const uuid = ref.startsWith('db://') ? (await Editor.Message.request('asset-db', 'query-uuid', ref)) : ref;
    if (!uuid)
        fail(`No asset found for "${ref}".`);
    return new Promise((resolve, reject) => {
        cc().assetManager.loadAny({ uuid }, (err, asset) => (err ? reject(err) : resolve(asset)));
    });
};
const refNode = (ref) => {
    try {
        return resolveNode({ uuid: ref });
    }
    catch {
        return resolveNode({ path: ref });
    }
};
/**
 * JSON can't carry engine objects, so a property value may name one:
 * `{"$asset": uuid|db://url}`, `{"$node": uuid|path}`, `{"$component": {"node": uuid|path, "type": "cc.Sprite"}}`.
 * Resolved recursively through arrays; anything else passes through.
 */
const resolveRefs = async (value) => {
    if (Array.isArray(value))
        return Promise.all(value.map(resolveRefs));
    if (value && typeof value === 'object') {
        if (typeof value.$asset === 'string')
            return loadAsset(value.$asset);
        if (typeof value.$node === 'string')
            return refNode(value.$node);
        if (value.$component && typeof value.$component === 'object') {
            return findComponent(refNode(String(value.$component.node)), value.$component.type, value.$component.index);
        }
    }
    return value;
};
/** Create a node (and, recursively, its `children`) from a plain spec. */
const buildNode = (spec, parent) => {
    const C = cc();
    const node = new C.Node(spec.name || 'New Node');
    parent.addChild(node);
    if (spec.position)
        node.setPosition(vec(spec.position, C.Vec3));
    if (spec.rotation)
        node.setRotationFromEuler(vec(spec.rotation, C.Vec3));
    if (spec.scale)
        node.setScale(vec(spec.scale, C.Vec3));
    if (typeof spec.active === 'boolean')
        node.active = spec.active;
    for (const type of spec.components ?? []) {
        if (!addComponentTo(node, type))
            fail(`Unknown component type "${type}".`);
    }
    for (const child of spec.children ?? [])
        buildNode(child, node);
    return node;
};
const vec = (value, Ctor) => {
    if (value === undefined || value === null)
        return undefined;
    if (value instanceof Ctor)
        return value;
    if (Array.isArray(value))
        return new Ctor(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
    if (typeof value === 'object')
        return new Ctor(value.x ?? 0, value.y ?? 0, value.z ?? 0);
    fail(`Cannot build ${Ctor.name} from ${JSON.stringify(value)}.`);
};
/** Build the right engine value for `target[property]` from a plain JSON value. */
const coerce = (current, value) => {
    const C = cc();
    if (current instanceof C.Vec3)
        return vec(value, C.Vec3);
    if (current instanceof C.Vec2) {
        if (Array.isArray(value))
            return new C.Vec2(value[0] ?? 0, value[1] ?? 0);
        return new C.Vec2(value?.x ?? 0, value?.y ?? 0);
    }
    if (current instanceof C.Quat) {
        const src = Array.isArray(value) ? { x: value[0], y: value[1], z: value[2], w: value[3] } : value ?? {};
        return new C.Quat(src.x ?? 0, src.y ?? 0, src.z ?? 0, src.w ?? 1);
    }
    if (current instanceof C.Color) {
        if (typeof value === 'string')
            return new C.Color().fromHEX(value);
        if (Array.isArray(value))
            return new C.Color(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 255);
        return new C.Color(value?.r ?? 0, value?.g ?? 0, value?.b ?? 0, value?.a ?? 255);
    }
    if (current instanceof C.Size) {
        if (Array.isArray(value))
            return new C.Size(value[0] ?? 0, value[1] ?? 0);
        return new C.Size(value?.width ?? 0, value?.height ?? 0);
    }
    return value;
};
const componentTypes = (node) => node.components.map((component) => cc().js.getClassName(component)).filter(Boolean);
const nodeDump = (node, includeComponents = true) => ({
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
});
const tree = (node, depth, maxDepth, includeComponents) => {
    const out = nodeDump(node, includeComponents);
    out['children'] =
        depth >= maxDepth ? [] : visibleChildren(node).map((child) => tree(child, depth + 1, maxDepth, includeComponents));
    return out;
};
const findComponent = (node, type, index) => {
    const matches = node.components.filter((component) => cc().js.getClassName(component) === type);
    const chosen = index === undefined ? matches[0] : matches[index];
    if (!chosen)
        fail(`Node "${node.name}" has no component of type "${type}"${index === undefined ? '' : ` at index ${index}`}.`);
    return chosen;
};
// ---------------------------------------------------------------------------
// Methods callable from the editor
// ---------------------------------------------------------------------------
function load() { }
function unload() { }
exports.methods = {
    sceneInfo() {
        const s = scene();
        return { name: s.name, uuid: uuidOf(s), childCount: s.children.length };
    },
    nodeTree(args = []) {
        const [options = {}] = args;
        const maxDepth = typeof options.maxDepth === 'number' ? options.maxDepth : 6;
        const includeComponents = options.includeComponents !== false;
        return tree(scene(), 0, maxDepth, includeComponents);
    },
    findNodes(args = []) {
        const [query = {}] = args;
        const matches = [];
        walk(scene(), (node) => {
            const nameHit = !query.name || node.name === query.name || node.name.includes(query.name);
            const typeHit = !query.component || componentTypes(node).includes(query.component);
            if (nameHit && typeHit)
                matches.push(nodeDump(node));
            return false;
        });
        return matches;
    },
    getNode(args = []) {
        return nodeDump(resolveNode(args[0] ?? {}));
    },
    createNode(args = []) {
        const [options = {}] = args;
        return nodeDump(buildNode(options, resolveParent(options)));
    },
    /** Create a whole subtree in one call: `{name, components, position, children: [...]}` under a parent. */
    createNodeTree(args = []) {
        const [options = {}] = args;
        if (!options.tree || typeof options.tree !== 'object')
            fail('Provide "tree".');
        return tree(buildNode(options.tree, resolveParent(options)), 0, 99, true);
    },
    setSiblingIndex(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        if (typeof options.index !== 'number')
            fail('Provide a numeric "index".');
        node.setSiblingIndex(options.index);
        return nodeDump(node);
    },
    deleteNode(args = []) {
        const node = resolveNode(args[0] ?? {});
        if (node === scene())
            fail('Refusing to delete the scene root.');
        const name = node.name;
        node.destroy();
        return ok({ deleted: name });
    },
    duplicateNode(args = []) {
        const [options = {}] = args;
        const C = cc();
        const source = resolveNode(options);
        const clone = C.instantiate(source);
        clone.parent = source.parent;
        if (options.name)
            clone.name = options.name;
        return nodeDump(clone);
    },
    renameNode(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        if (typeof options.name !== 'string' || options.name === '')
            fail('Provide "name".');
        node.name = options.name;
        return nodeDump(node);
    },
    setNodeTransform(args = []) {
        const [options = {}] = args;
        const C = cc();
        const node = resolveNode(options);
        if (options.position)
            node.setPosition(vec(options.position, C.Vec3));
        if (options.rotation)
            node.setRotationFromEuler(vec(options.rotation, C.Vec3));
        if (options.scale)
            node.setScale(vec(options.scale, C.Vec3));
        if (typeof options.active === 'boolean')
            node.active = options.active;
        if (typeof options.layer === 'number')
            node.layer = options.layer;
        return nodeDump(node);
    },
    setNodeParent(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        const parent = resolveParent(options);
        if (node === scene())
            fail('Cannot reparent the scene root.');
        for (let up = parent; up; up = up.parent) {
            if (up === node)
                fail('Cannot make a node a child of itself or of its own descendant.');
        }
        node.setParent(parent, options.keepWorldTransform === true);
        return nodeDump(node);
    },
    async setNodeProperty(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        if (typeof options.property !== 'string')
            fail('Provide "property".');
        node[options.property] = coerce(node[options.property], await resolveRefs(options.value));
        return nodeDump(node);
    },
    listComponents(args = []) {
        const node = resolveNode(args[0] ?? {});
        return node.components.map((component) => ({
            type: cc().js.getClassName(component),
            enabled: component.enabled !== false,
        }));
    },
    addComponent(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        if (typeof options.type !== 'string')
            fail('Provide "type".');
        if (!addComponentTo(node, options.type))
            fail(`Unknown component type "${options.type}".`);
        return nodeDump(node);
    },
    removeComponent(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        const component = findComponent(node, options.type, options.index);
        component.destroy();
        // destroy() is deferred to the end of the frame, so `node.components` still lists it — drop it from the reply.
        const dump = nodeDump(node);
        const remaining = node.components.filter((c) => c !== component);
        return { ...dump, components: remaining.map((c) => cc().js.getClassName(c)).filter(Boolean) };
    },
    getComponentProperty(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        const component = findComponent(node, options.type, options.index);
        return { type: options.type, property: options.property, value: plain(component[options.property]) };
    },
    async setComponentProperty(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        const component = findComponent(node, options.type, options.index);
        if (typeof options.property !== 'string')
            fail('Provide "property".');
        component[options.property] = coerce(component[options.property], await resolveRefs(options.value));
        return { type: options.type, property: options.property, value: plain(component[options.property]) };
    },
    async callComponentMethod(args = []) {
        const [options = {}] = args;
        const node = resolveNode(options);
        const component = findComponent(node, options.type, options.index);
        const fn = component[options.method];
        if (typeof fn !== 'function')
            fail(`Component "${options.type}" has no method "${options.method}".`);
        const result = await fn.apply(component, options.args ?? []);
        return { result: plain(result) };
    },
    listComponentTypes() {
        const C = cc();
        const names = new Set();
        for (const value of Object.values(C)) {
            if (typeof value === 'function' && value.prototype instanceof C.Component) {
                const name = C.js.getClassName(value);
                if (name)
                    names.add(name);
            }
        }
        return [...names].sort();
    },
    async instantiatePrefab(args = []) {
        const [options = {}] = args;
        if (typeof options.uuid !== 'string')
            fail('Provide the prefab asset "uuid".');
        const C = cc();
        const prefab = await loadAsset(options.uuid);
        const node = C.instantiate(prefab);
        const parent = resolveParent(options);
        parent.addChild(node);
        if (options.position)
            node.setPosition(vec(options.position, C.Vec3));
        return nodeDump(node);
    },
    /** Escape hatch: evaluate JavaScript in the engine runtime with `cc` in scope. */
    async evalScript(args = []) {
        const [options = {}] = args;
        if (typeof options.code !== 'string')
            fail('Provide "code".');
        // eslint-disable-next-line no-new-func
        const fn = new Function('cc', 'args', `"use strict"; return (async () => { ${options.code}\n })();`);
        return plain(await fn(cc(), options.args ?? null));
    },
};
/** Register a component class by name (`cc.js.getClassByName`). */
const addComponentTo = (node, type) => {
    const C = cc();
    const klass = C.js.getClassByName(type);
    if (typeof klass !== 'function')
        return false;
    node.addComponent(klass);
    return true;
};
/** Convert an engine value to JSON-safe data (Vec3/Color/… → plain objects). */
const plain = (value) => {
    const C = cc();
    if (value === null || value === undefined)
        return value;
    if (value instanceof C.Vec3)
        return { x: value.x, y: value.y, z: value.z };
    if (value instanceof C.Vec2)
        return { x: value.x, y: value.y };
    if (value instanceof C.Quat)
        return { x: value.x, y: value.y, z: value.z, w: value.w };
    if (value instanceof C.Color)
        return { r: value.r, g: value.g, b: value.b, a: value.a };
    if (value instanceof C.Size)
        return { width: value.width, height: value.height };
    if (value instanceof C.Node)
        return nodeDump(value);
    if (Array.isArray(value))
        return value.map(plain);
    if (typeof value === 'object') {
        const out = {};
        for (const [key, inner] of Object.entries(value))
            out[key] = plain(inner);
        return out;
    }
    return value;
};
//# sourceMappingURL=scene.js.map